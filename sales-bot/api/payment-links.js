import crypto from "node:crypto";
import { getPublicBaseUrl, hashPaymentToken, pawapayRequest, secureStringEqual, supportsDepositQuote, supabaseRequest, validateQuote } from "../lib/pawapay-payments.js";

function reply(response, code, body) {
  response.setHeader("Cache-Control", "no-store");
  response.status(code).json(body);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reply(response, 405, { error: "Method not allowed" });
  }
  const expected = process.env.PAYMENT_LINK_ADMIN_TOKEN;
  const authorization = String(request.headers.authorization || "");
  if (!expected || !secureStringEqual(authorization, `Bearer ${expected}`)) {
    return reply(response, 401, { error: "Staff authorization is required." });
  }

  try {
    const quote = validateQuote(request.body);
    const { response: configResponse, data: config } = await pawapayRequest("/v2/active-conf?operationType=DEPOSIT");
    if (!configResponse.ok || !Array.isArray(config.countries)) {
      return reply(response, 502, { error: "Could not read the enabled PawaPay payment options." });
    }
    if (!supportsDepositQuote(config, quote)) return reply(response, 422, { error: `The amount or currency is not currently enabled for deposits on this PawaPay account.` });

    const baseUrl = getPublicBaseUrl(request);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRequest("pawapay_payment_links", {
      method: "POST",
      headers: { Prefer: "return=representation" },
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
    return reply(response, 201, {
      link: `${baseUrl}/payment.html?token=${encodeURIComponent(token)}`,
      expiresAt,
      amount: quote.amount,
      currency: quote.currency
    });
  } catch (error) {
    const clientError = /Enter a |Choose a /.test(error.message || "");
    if (!clientError) console.error("Payment link creation failed:", error.message);
    return reply(response, clientError ? 400 : 503, { error: clientError ? error.message : "Could not create the payment link. Check server configuration." });
  }
}
