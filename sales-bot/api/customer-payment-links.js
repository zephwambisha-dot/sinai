import crypto from "node:crypto";
import { getPublicBaseUrl, hashPaymentToken, pawapayRequest, supportsDepositQuote, supabaseRequest, validateQuote } from "../lib/pawapay-payments.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;

function reply(response, code, body) {
  response.setHeader("Cache-Control", "no-store");
  response.status(code).json(body);
}

function sameOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return false;
  const forwardedHost = request.headers?.["x-forwarded-host"] || request.headers?.host || "";
  const host = String(forwardedHost).split(",")[0].trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function rateLimited(request) {
  const forwardedFor = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwardedFor || request.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windows = globalThis.__sinAiPaymentEntryWindows || (globalThis.__sinAiPaymentEntryWindows = new Map());
  const current = windows.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= MAX_REQUESTS) return true;
  current.count += 1;
  return false;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reply(response, 405, { error: "Method not allowed" });
  }
  if (!sameOrigin(request)) return reply(response, 403, { error: "This request is not allowed." });
  if (String(request.body?.website || "").trim()) return reply(response, 400, { error: "Please check the payment details and try again." });
  if (rateLimited(request)) return reply(response, 429, { error: "Too many attempts. Wait a few minutes and try again." });

  let quote;
  try {
    quote = validateQuote(request.body);
  } catch (error) {
    return reply(response, 400, { error: error.message });
  }

  try {
    const { response: configResponse, data: config } = await pawapayRequest("/v2/active-conf?operationType=DEPOSIT");
    if (!configResponse.ok || !Array.isArray(config.countries)) {
      return reply(response, 502, { error: "Could not confirm the available payment options. Please try again." });
    }
    if (!supportsDepositQuote(config, quote)) {
      return reply(response, 422, { error: "That amount or currency is not available for deposits. Check the quote with SIN AI." });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest("pawapay_payment_links", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: hashPaymentToken(token),
        reference: quote.reference,
        amount: quote.amount,
        currency: quote.currency,
        reason: quote.reason,
        status: "OPEN",
        expires_at: expiresAt
      })
    });
    const baseUrl = getPublicBaseUrl(request);
    return reply(response, 201, {
      paymentUrl: `${baseUrl}/payment.html?token=${encodeURIComponent(token)}`,
      amount: quote.amount,
      currency: quote.currency,
      expiresAt
    });
  } catch (error) {
    console.error("Customer payment link creation failed:", error.message);
    return reply(response, 503, { error: "Could not prepare the payment. Please try again or contact SIN AI." });
  }
}
