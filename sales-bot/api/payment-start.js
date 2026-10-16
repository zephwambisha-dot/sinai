import crypto from "node:crypto";
import { getPublicBaseUrl, hashPaymentToken, pawapayRequest, supabaseRequest } from "../lib/pawapay-payments.js";

function reply(response, code, body) {
  response.setHeader("Cache-Control", "no-store");
  response.status(code).json(body);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reply(response, 405, { error: "Method not allowed" });
  }
  const token = String(request.body?.token || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return reply(response, 400, { error: "This payment link is invalid." });

  try {
    const hash = hashPaymentToken(token);
    const rows = await supabaseRequest(`pawapay_payment_links?token_hash=eq.${hash}&select=id,amount,currency,reason,reference,status,provider_status,expires_at&limit=1`);
    const link = rows?.[0];
    if (!link) return reply(response, 404, { error: "This payment link was not found." });
    if (new Date(link.expires_at).getTime() <= Date.now()) return reply(response, 410, { error: "This payment link has expired. Please contact SIN AI for a new one." });
    if (link.status === "PAID") return reply(response, 409, { error: "This quote is already paid." });
    if (link.status === "PROCESSING") return reply(response, 409, { error: "A payment is already in progress. Approve it on your phone or wait for the final status." });

    const depositId = crypto.randomUUID();
    const baseUrl = getPublicBaseUrl(request);
    const claimResponse = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/pawapay_payment_links?id=eq.${link.id}&status=eq.OPEN`, {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ status: "PROCESSING", provider_status: "INITIATING", deposit_id: depositId, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000)
    });
    const claimedRows = await claimResponse.json().catch(() => []);
    if (!claimResponse.ok || !claimedRows.length) return reply(response, 409, { error: "Another payment attempt is already being prepared. Refresh this page in a moment." });

    const { response: providerResponse, data } = await pawapayRequest("/v2/payment-page/deposits", {
      method: "POST",
      body: JSON.stringify({
        depositId,
        returnUrl: `${baseUrl}/payment.html?token=${encodeURIComponent(token)}`,
        customerMessage: "SIN AI Services",
        amountDetails: { amount: String(link.amount), currency: link.currency },
        language: "EN",
        reason: link.reason,
        metadata: [{ invoiceReference: link.reference }]
      })
    });
    const redirectUrl = data.redirectUrl || data.redirectURL;
    if (!providerResponse.ok || !redirectUrl || data.status === "REJECTED") {
      await supabaseRequest(`pawapay_payment_links?id=eq.${link.id}&deposit_id=eq.${depositId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "OPEN", provider_status: data.status || "REJECTED", deposit_id: null, updated_at: new Date().toISOString() })
      });
      return reply(response, 502, { error: "PawaPay could not start this payment. Please try again or contact SIN AI." });
    }

    await supabaseRequest(`pawapay_payment_links?id=eq.${link.id}&deposit_id=eq.${depositId}&status=eq.PROCESSING&provider_status=eq.INITIATING`, {
      method: "PATCH",
      body: JSON.stringify({ status: "PROCESSING", provider_status: data.status || "ACCEPTED", redirect_url: redirectUrl, updated_at: new Date().toISOString() })
    });
    return reply(response, 200, { redirectUrl });
  } catch (error) {
    console.error("PawaPay payment start failed:", error.message);
    return reply(response, 503, { error: "Could not start the payment right now. Please refresh and try again." });
  }
}
