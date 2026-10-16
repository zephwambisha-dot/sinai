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
  const currencies = new Set();
  for (const country of config.countries || []) {
    for (const provider of country.providers || []) {
      for (const item of provider.currencies || []) {
        if (item.operationTypes?.DEPOSIT?.status === "OPERATIONAL") currencies.add(item.currency);
      }
    }
  }
  return [...currencies].sort();
}

export function supportsDepositQuote(config = {}, quote) {
  return (config.countries || []).some(country =>
    (country.providers || []).some(provider =>
      (provider.currencies || []).some(item =>
        item.currency === quote.currency &&
        item.operationTypes?.DEPOSIT?.status === "OPERATIONAL" &&
        Number(quote.amount) >= Number(item.operationTypes.DEPOSIT.minTransactionLimit || 0) &&
        Number(quote.amount) <= Number(item.operationTypes.DEPOSIT.maxTransactionLimit || Number.POSITIVE_INFINITY)
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
