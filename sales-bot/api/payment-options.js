import { getDepositPaymentOptions, pawapayRequest } from "../lib/pawapay-payments.js";

function reply(response, code, body) {
  response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
  response.status(code).json(body);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return reply(response, 405, { error: "Method not allowed" });
  }
  try {
    const { response: configResponse, data: config } = await pawapayRequest("/v2/active-conf?operationType=DEPOSIT");
    if (!configResponse.ok || !Array.isArray(config.countries)) {
      console.warn("PawaPay active configuration unavailable:", JSON.stringify({
        status: configResponse.status,
        failureCode: config.failureReason?.failureCode || null,
        countriesArray: Array.isArray(config.countries)
      }));
      return reply(response, 502, { error: "Payment currencies are temporarily unavailable." });
    }
    return reply(response, 200, { countries: getDepositPaymentOptions(config) });
  } catch (error) {
    console.error("PawaPay currency lookup failed:", error.message);
    return reply(response, 503, { error: "Payment currencies are temporarily unavailable." });
  }
}
