import crypto from "node:crypto";
import { getDepositPaymentOptions, getPublicBaseUrl, hashPaymentToken, normalizePawapayPhone, pawapayRequest, supabaseRequest, validateQuote } from "../lib/pawapay-payments.js";

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
    const amountQuote = validateQuote({
      reference: "SIN-PAYMENT",
      reason: "SIN AI services",
      amount: request.body?.amount,
      currency: request.body?.currency
    });
    quote = { ...amountQuote, country: String(request.body?.country || "").toUpperCase() };
    if (!/^[A-Z]{3}$/.test(quote.country)) throw new Error("Choose your country.");
  } catch (error) {
    return reply(response, 400, { error: error.message });
  }

  try {
    const { response: configResponse, data: config } = await pawapayRequest("/v2/active-conf?operationType=DEPOSIT");
    if (!configResponse.ok || !Array.isArray(config.countries)) {
      return reply(response, 502, { error: "Could not confirm the available payment options. Please try again." });
    }
    const option = getDepositPaymentOptions(config).find(item => item.country === quote.country && item.currency === quote.currency);
    if (!option || Number(quote.amount) < option.minTransactionLimit || Number(quote.amount) > option.maxTransactionLimit) {
      return reply(response, 422, { error: "That amount or currency is not available for deposits. Check the quote with SIN AI." });
    }

    let phoneNumber;
    try {
      phoneNumber = normalizePawapayPhone(request.body?.phoneNumber, option.prefix);
    } catch (error) {
      return reply(response, 400, { error: error.message });
    }
    const reference = `SIN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const depositId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const baseUrl = getPublicBaseUrl(request);

    await supabaseRequest("pawapay_payment_links", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: hashPaymentToken(token),
        reference,
        amount: quote.amount,
        currency: quote.currency,
        reason: quote.reason,
        status: "INITIATING",
        provider_status: "INITIATING",
        manual_review_status: "PENDING",
        deposit_id: depositId,
        country: quote.country,
        phone_number: phoneNumber,
        expires_at: expiresAt
      })
    });

    const { response: providerResponse, data } = await pawapayRequest("/v2/paymentpage", {
      method: "POST",
      body: JSON.stringify({
        depositId,
        returnUrl: `${baseUrl}/payment-return.html?reference=${encodeURIComponent(reference)}`,
        customerMessage: "SIN AI Services",
        amountDetails: { amount: quote.amount, currency: quote.currency },
        phoneNumber,
        country: quote.country,
        language: "EN",
        reason: quote.reason,
        metadata: [{ invoiceReference: reference }]
      })
    });
    const redirectUrl = data.redirectUrl || data.redirectURL;
    if (!providerResponse.ok || !redirectUrl || data.status === "REJECTED") {
      await supabaseRequest(`pawapay_payment_links?deposit_id=eq.${encodeURIComponent(depositId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "OPEN", provider_status: data.status || "REJECTED", updated_at: new Date().toISOString() })
      });
      console.warn("PawaPay payment page session was rejected:", JSON.stringify({ status: providerResponse.status, failureCode: data.failureReason?.failureCode || null }));
      return reply(response, 502, { error: "PawaPay could not start this payment. Please check the phone and try again." });
    }
    await supabaseRequest(`pawapay_payment_links?deposit_id=eq.${encodeURIComponent(depositId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "PROCESSING", provider_status: data.status || "SESSION_CREATED", redirect_url: redirectUrl, updated_at: new Date().toISOString() })
    });
    return reply(response, 201, {
      paymentUrl: redirectUrl,
      reference,
      amount: quote.amount,
      currency: quote.currency
    });
  } catch (error) {
    console.error("Customer payment link creation failed:", error.message);
    return reply(response, 503, { error: "Could not prepare the payment. Please try again or contact SIN AI." });
  }
}
