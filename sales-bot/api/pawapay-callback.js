import {
  parseStatusAndId,
  persistPawaPayCallback,
  readRawBody,
  verifyPawaPayCallback
} from "../lib/pawapay-callback.js";

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const rawBody = await readRawBody(request);
    if (!rawBody.length) {
      response.status(400).json({ error: "Callback body is required" });
      return;
    }
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      response.status(415).json({ error: "Content-Type must be application/json" });
      return;
    }

    await verifyPawaPayCallback(request, rawBody);
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      response.status(400).json({ error: "Callback body must be valid JSON" });
      return;
    }

    const record = parseStatusAndId(payload);
    await persistPawaPayCallback(record);
    response.status(200).json({ received: true });
  } catch (error) {
    const message = error?.message || "Callback could not be processed";
    const clientError = /signature|digest|header|body|transaction ID|status|Content-Type|too large|validity window/i.test(message);
    if (!clientError) console.error("PawaPay callback processing failed:", message);
    response.status(clientError ? 400 : 503).json({ error: clientError ? "Invalid callback" : "Callback storage or verification unavailable" });
  }
}
