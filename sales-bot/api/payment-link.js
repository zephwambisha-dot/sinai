import { hashPaymentToken, pawapayRequest, publicQuote, supabaseRequest } from "../lib/pawapay-payments.js";

function reply(response, code, body) {
  response.setHeader("Cache-Control", "no-store");
  response.status(code).json(body);
}

function getToken(request) {
  const token = String(request.query?.token || "");
  return /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : "";
}

async function findLink(token) {
  if (!token) return null;
  const hash = hashPaymentToken(token);
  const rows = await supabaseRequest(`pawapay_payment_links?token_hash=eq.${hash}&select=id,amount,currency,reason,status,provider_status,deposit_id,created_at,expires_at&limit=1`);
  return rows?.[0] || null;
}

export default async function handler(request, response) {
  const token = getToken(request);
  if (!token) return reply(response, 400, { error: "This payment link is invalid." });

  try {
    const link = await findLink(token);
    if (!link) return reply(response, 404, { error: "This payment link was not found." });
    if (link.deposit_id && ["INITIATING", "PROCESSING"].includes(link.status)) {
      const { response: providerResponse, data } = await pawapayRequest(`/v2/deposits/${encodeURIComponent(link.deposit_id)}`);
      const providerStatus = data.status === "FOUND" ? data.data?.status : null;
      if (providerResponse.ok && providerStatus && providerStatus !== link.provider_status) {
        const status = providerStatus === "COMPLETED" ? "PAID" : providerStatus === "ACCEPTED" ? "PROCESSING" : "OPEN";
        await supabaseRequest(`pawapay_payment_links?id=eq.${link.id}&deposit_id=eq.${encodeURIComponent(link.deposit_id)}&status=eq.PROCESSING`, {
          method: "PATCH",
          body: JSON.stringify({ status, provider_status: providerStatus, updated_at: new Date().toISOString() })
        });
        link.status = status;
        link.provider_status = providerStatus;
      }
    }
    return reply(response, 200, { quote: publicQuote(link) });
  } catch (error) {
    console.error("Payment link lookup failed:", error.message);
    return reply(response, 503, { error: "Payment details are temporarily unavailable. Please try again." });
  }
}
