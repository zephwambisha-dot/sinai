import crypto from "node:crypto";

export function pawapayBaseUrl() {
  return process.env.PAWAPAY_ENV === "production"
    ? "https://api.pawapay.io"
    : "https://api.sandbox.pawapay.io";
}

export function hashPaymentToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function secureStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validateQuote(body = {}) {
  const reference = String(body.reference || "").trim();
  const reason = String(body.reason || "").trim();
  let amount = String(body.amount ?? "").trim();
  const currency = String(body.currency || "").trim().toUpperCase();

  if (!reference || reference.length > 80) throw new Error("Enter a quote or invoice reference (up to 80 characters).");
  if (!reason || reason.length > 50) throw new Error("Enter a payment description (up to 50 characters).");
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,3})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("Enter a valid positive amount with up to 3 decimal places.");
  }
  amount = amount.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a 3-letter currency code, such as UGX.");
  return { reference, reason, amount, currency };
}

export function getOperationalDepositCurrencies(config = {}) {
  return [...new Set(getDepositPaymentOptions(config).map(option => option.currency))].sort();
}

function depositOperation(operationTypes) {
  if (Array.isArray(operationTypes)) {
    const entry = operationTypes.find(item => item?.operationType === "DEPOSIT" || item?.DEPOSIT);
    return entry?.DEPOSIT || entry || {};
  }
  return operationTypes?.DEPOSIT || {};
}

export function getDepositPaymentOptions(config = {}) {
  const options = new Map();
  for (const country of config.countries || []) {
    const countryCode = String(country.country || "").toUpperCase();
    const name = typeof country.displayName === "string"
      ? country.displayName
      : country.displayName?.en || countryCode;
    for (const provider of country.providers || []) {
      for (const item of provider.currencies || []) {
        const operation = depositOperation(item.operationTypes);
        if (operation.status !== "OPERATIONAL" || !/^[A-Z]{3}$/.test(item.currency || "")) continue;
        const key = `${countryCode}:${item.currency}`;
        const current = options.get(key) || {
          country: countryCode,
          name,
          prefix: String(country.prefix || "").replace(/\D/g, ""),
          currency: item.currency,
          minTransactionLimit: Number(operation.minTransactionLimit || 0),
          maxTransactionLimit: Number(operation.maxTransactionLimit || Number.POSITIVE_INFINITY),
          decimals: operation.decimalsInAmount === "NONE" ? 0 : Number(operation.decimalsInAmount || 3)
        };
        current.minTransactionLimit = Math.min(current.minTransactionLimit, Number(operation.minTransactionLimit || 0));
        current.maxTransactionLimit = Math.max(current.maxTransactionLimit, Number(operation.maxTransactionLimit || Number.POSITIVE_INFINITY));
        if (operation.decimalsInAmount !== "NONE") current.decimals = Math.max(current.decimals, Number(operation.decimalsInAmount || 3));
        options.set(key, current);
      }
    }
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));
}

export function normalizePawapayPhone(input, countryPrefix) {
  const raw = String(input || "").trim();
  if (!/^[\d\s().-]+$/.test(raw)) throw new Error("Enter a valid mobile money phone number.");
  let digits = raw.replace(/\D/g, "");
  const prefix = String(countryPrefix || "").replace(/\D/g, "");
  if (!prefix) throw new Error("This country is missing its mobile country code.");
  if (!digits.startsWith(prefix)) {
    throw new Error(`Enter the full international number starting with ${prefix}; do not start with 0 or add +.`);
  }
  if (digits.length < 8 || digits.length > 15 || !digits.startsWith(prefix) || digits.startsWith("0")) {
    throw new Error("Enter a valid phone number for the selected country.");
  }
  return digits;
}

export function supportsDepositQuote(config = {}, quote) {
  return (config.countries || []).some(country =>
    (!quote.country || country.country === quote.country) &&
    (country.providers || []).some(provider =>
      (provider.currencies || []).some(item =>
        item.currency === quote.currency &&
        depositOperation(item.operationTypes).status === "OPERATIONAL" &&
        Number(quote.amount) >= Number(depositOperation(item.operationTypes).minTransactionLimit || 0) &&
        Number(quote.amount) <= Number(depositOperation(item.operationTypes).maxTransactionLimit || Number.POSITIVE_INFINITY)
      )
    )
  );
}

export async function pawapayRequest(path, options = {}) {
  const token = process.env.PAWAPAY_API_TOKEN;
  if (!token) throw new Error("PawaPay is not configured on the server.");
  const response = await fetch(`${pawapayBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* handled as an upstream error */ }
  return { response, data };
}

export async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new Error("Payment storage is not configured on the server.");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Payment storage failed (${response.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export function getPublicBaseUrl(request) {
  const configured = process.env.PAYMENT_BASE_URL?.replace(/\/$/, "");
  if (configured && /^https:\/\//i.test(configured)) return configured;
  const host = request.headers?.["x-forwarded-host"] || request.headers?.host;
  const proto = request.headers?.["x-forwarded-proto"] || "https";
  if (!host) throw new Error("Payment site URL is not configured.");
  return `${proto}://${host}`;
}

export function publicQuote(row) {
  return {
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    paymentStatus: row.provider_status || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    canPay: row.status === "OPEN" && new Date(row.expires_at).getTime() > Date.now()
  };
}
