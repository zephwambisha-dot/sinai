import crypto from "node:crypto";

export const config = { api: { bodyParser: false } };

const SANDBOX_URL = "https://api.sandbox.pawapay.io/v2/deposits";
const TEST_WALLETS = new Map([
  ["256753456789", "MTN_MOMO_UGA"],
  ["256783456789", "AIRTEL_OAPI_UGA"]
]);

function send(response, status, body) {
  response.setHeader?.("Cache-Control", "no-store");
  response.status(status).json(body);
}

function constantTimeMatch(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  const receivedBuffer = Buffer.from(String(received || ""), "utf8");
  return expectedBuffer.length > 0 && expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function readJson(request, maxBytes = 8192) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("Body too large");
    chunks.push(buffer);
  }
  if (!total) throw new Error("Body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Body must be valid JSON");
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader?.("Allow", "POST");
    return send(response, 405, { error: "Method not allowed" });
  }

  if (process.env.PAWAPAY_ENV !== "sandbox" || !process.env.PAWAPAY_API_TOKEN || !process.env.PAWAPAY_SANDBOX_TEST_KEY) {
    return send(response, 503, { error: "Sandbox payment testing is not configured for this deployment" });
  }

  const testKey = request.headers?.["x-pawapay-test-key"] || "";
  if (!constantTimeMatch(process.env.PAWAPAY_SANDBOX_TEST_KEY, testKey)) {
    return send(response, 401, { error: "Unauthorized" });
  }

  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    return send(response, 400, { error: error.message });
  }

  const phoneNumber = typeof input?.phoneNumber === "string" ? input.phoneNumber : "";
  const provider = TEST_WALLETS.get(phoneNumber);
  if (!provider) {
    return send(response, 400, {
      error: "Use one of the documented Uganda Sandbox test numbers",
      testNumbers: Object.fromEntries(TEST_WALLETS)
    });
  }

  const amountText = typeof input?.amount === "number" ? String(input.amount) : input?.amount;
  if (typeof amountText !== "string" || !/^(?:[1-9]\d{0,2}|1000)$/.test(amountText)) {
    return send(response, 400, { error: "Sandbox test amount must be a whole UGX amount from 1 to 1000" });
  }

  const depositId = crypto.randomUUID();
  const payload = {
    amount: amountText,
    currency: "UGX",
    depositId,
    payer: {
      type: "MMO",
      accountDetails: { provider, phoneNumber }
    },
    customerMessage: "SIN AI sandbox test",
    clientReferenceId: `SIN-TEST-${depositId.slice(0, 8)}`
  };

  try {
    const upstream = await fetch(SANDBOX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAWAPAY_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    let result = {};
    try {
      result = await upstream.json();
    } catch {
      result = {};
    }

    if (!upstream.ok) {
      return send(response, 502, {
        error: "PawaPay Sandbox rejected the test request",
        pawapayHttpStatus: upstream.status,
        failureReason: result?.failureReason || null
      });
    }

    return send(response, 200, {
      environment: "sandbox",
      depositId: result?.depositId || depositId,
      status: result?.status || "UNKNOWN",
      message: "This is a Sandbox result. Check the final transaction status in PawaPay or wait for its callback."
    });
  } catch {
    return send(response, 502, { error: "Could not reach PawaPay Sandbox" });
  }
}
