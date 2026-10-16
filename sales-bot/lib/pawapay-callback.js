import crypto from "node:crypto";

const HEADER_NAMES = new Set([
  "signature-date",
  "content-digest",
  "content-type"
]);

function header(request, name) {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function parseSignatureField(value, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(value || "").match(new RegExp(`(?:^|,\\s*)${escaped}=\\s*:([^:]+):`));
  return match?.[1] || "";
}

function parseSignatureInput(value) {
  const match = String(value || "").match(/(?:^|,\s*)([A-Za-z0-9_-]+)=\(([^)]*)\)((?:;[^,]+)*)/);
  if (!match) throw new Error("Malformed Signature-Input header");

  const label = match[1];
  const components = [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1]);
  const parameters = match[3];
  const getParameter = name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = parameters.match(new RegExp(`(?:^|;)\\s*${escaped}=(?:"([^"]*)"|([^;]+))`));
    return found ? (found[1] ?? found[2]).trim() : "";
  };

  if (!components.length || components.some(component =>
    component !== "@method" && component !== "@authority" && component !== "@path" && !HEADER_NAMES.has(component.toLowerCase())
  )) {
    throw new Error("Signature-Input includes an unsupported component");
  }

  return {
    label,
    components,
    parameters,
    algorithm: getParameter("alg"),
    keyId: getParameter("keyid"),
    created: Number(getParameter("created")),
    expires: Number(getParameter("expires"))
  };
}

function buildSignatureBase(request, parsed, signatureInput) {
  const host = header(request, "host");
  const path = String(request.url || "/").split("?", 1)[0];
  if (!host || !path.startsWith("/")) throw new Error("Could not determine callback host and path");

  const lines = parsed.components.map(component => {
    let value;
    if (component === "@method") value = String(request.method || "POST").toUpperCase();
    else if (component === "@authority") value = host;
    else if (component === "@path") value = path;
    else value = header(request, component);
    if (!value) throw new Error(`Missing signed component: ${component}`);
    return `"${component}": ${String(value).trim().replace(/[ \t]+/g, " ")}`;
  });

  lines.push(`"@signature-params": (${parsed.components.map(component => `"${component}"`).join(" ")})${signatureInput}`);
  return lines.join("\n");
}

function parseContentDigest(value) {
  const match = String(value || "").match(/^sha-(256|512)=:([A-Za-z0-9+/]+=*):$/i);
  if (!match) throw new Error("Unsupported or missing Content-Digest");
  return { algorithm: `sha${match[1]}`, expected: Buffer.from(match[2], "base64") };
}

function verifyDigest(rawBody, digestHeader) {
  const { algorithm, expected } = parseContentDigest(digestHeader);
  const actual = crypto.createHash(algorithm).update(rawBody).digest();
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function nodeVerifyAlgorithm(algorithm) {
  const supported = {
    "ecdsa-p256-sha256": { digest: "sha256" },
    "ecdsa-p384-sha384": { digest: "sha384" },
    "rsa-v1_5-sha256": { digest: "sha256", padding: crypto.constants.RSA_PKCS1_PADDING },
    "rsa-pss-sha512": {
      digest: "sha512",
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }
  };
  return supported[algorithm];
}

function parseStatusAndId(payload) {
  const idKeys = [
    ["depositId", "DEPOSIT"],
    ["checkoutId", "CHECKOUT"],
    ["payoutId", "PAYOUT"],
    ["refundId", "REFUND"],
    ["remittanceId", "REMITTANCE"]
  ];
  const matches = idKeys.filter(([key]) => typeof payload[key] === "string" && payload[key].trim());
  if (matches.length !== 1) throw new Error("Callback must contain exactly one recognized transaction ID");
  const [[idKey, operationType]] = matches;
  const status = String(payload.status || "").trim().toUpperCase();
  if (!/^[A-Z_]{2,32}$/.test(status)) throw new Error("Callback has an invalid status");

  return {
    transaction_id: payload[idKey].trim(),
    operation_type: operationType,
    status,
    amount: typeof payload.amount === "string" || typeof payload.amount === "number" ? String(payload.amount) : null,
    currency: typeof payload.currency === "string" ? payload.currency : null,
    country: typeof payload.country === "string" ? payload.country : null,
    provider_transaction_id: typeof payload.providerTransactionId === "string" ? payload.providerTransactionId : null,
    callback_created_at: typeof payload.created === "string" ? payload.created : null
  };
}

async function readRawBody(request, maxBytes = 65536) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("Callback body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function apiBaseUrl() {
  return process.env.PAWAPAY_ENV === "production"
    ? "https://api.pawapay.io"
    : "https://api.sandbox.pawapay.io";
}

let cachedKeys = null;
let cachedKeysAt = 0;

async function getPublicKey(keyId) {
  const token = process.env.PAWAPAY_API_TOKEN;
  if (!token) throw new Error("PAWAPAY_API_TOKEN is not configured");
  const now = Date.now();
  if (!cachedKeys || now - cachedKeysAt > 10 * 60 * 1000) {
    const response = await fetch(`${apiBaseUrl()}/v2/public-key/http`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`PawaPay public-key lookup failed (${response.status})`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error("PawaPay returned an invalid public-key list");
    cachedKeys = new Map(body.map(item => [item.id, item.key]));
    cachedKeysAt = now;
  }
  return cachedKeys.get(keyId) || "";
}

export async function verifyPawaPayCallback(request, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const inputHeader = header(request, "signature-input");
  const parsed = parseSignatureInput(inputHeader);
  const signatureEncoded = parseSignatureField(header(request, "signature"), parsed.label);
  const signature = Buffer.from(signatureEncoded, "base64");
  if (!signature.length) throw new Error("Missing callback signature");

  const verification = nodeVerifyAlgorithm(parsed.algorithm);
  if (!verification) throw new Error("Unsupported callback signature algorithm");
  if (!Number.isInteger(parsed.created) || !Number.isInteger(parsed.expires) || parsed.expires < parsed.created) {
    throw new Error("Callback signature has invalid time parameters");
  }
  if (parsed.created > nowSeconds + 60 || parsed.expires < nowSeconds - 60 || parsed.expires - parsed.created > 600) {
    throw new Error("Callback signature is outside its validity window");
  }
  if (!verifyDigest(rawBody, header(request, "content-digest"))) {
    throw new Error("Callback body digest did not match");
  }

  const signatureBase = buildSignatureBase(request, parsed, parsed.parameters);
  const publicKey = await getPublicKey(parsed.keyId);
  if (!publicKey) throw new Error("PawaPay signing key was not found");

  const valid = crypto.verify(
    verification.digest,
    Buffer.from(signatureBase, "utf8"),
    {
      key: publicKey,
      ...(verification.padding ? { padding: verification.padding } : {}),
      ...(verification.saltLength ? { saltLength: verification.saltLength } : {})
    },
    signature
  );
  if (!valid) throw new Error("PawaPay callback signature is invalid");
  return true;
}

export async function persistPawaPayCallback(record) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase callback storage is not configured");

  const response = await fetch(`${baseUrl}/rest/v1/pawapay_callbacks?on_conflict=operation_type,transaction_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ ...record, received_at: new Date().toISOString() })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Callback storage failed (${response.status}): ${detail}`);
  }
}

export { parseStatusAndId, readRawBody };
