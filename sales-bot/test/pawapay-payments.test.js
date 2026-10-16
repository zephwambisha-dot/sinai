import test from "node:test";
import assert from "node:assert/strict";
import { hashPaymentToken, secureStringEqual, validateQuote } from "../lib/pawapay-payments.js";
import paymentStartHandler from "../api/payment-start.js";

test("validates a fixed international quote and normalizes its currency", () => {
  assert.deepEqual(validateQuote({
    reference: "SIN-2026-014",
    reason: "AI video package",
    amount: "1250.50",
    currency: "ugx"
  }), {
    reference: "SIN-2026-014",
    reason: "AI video package",
    amount: "1250.5",
    currency: "UGX"
  });
});

test("rejects invalid and zero quote amounts before contacting PawaPay", () => {
  for (const amount of ["0", "-1", "01", "12.1234", "1e3", ""]) {
    assert.throws(() => validateQuote({ reference: "Q-1", reason: "Service", amount, currency: "UGX" }));
  }
});

test("payment-link token hashes are stable and staff key comparison is exact", () => {
  assert.equal(hashPaymentToken("link-token"), hashPaymentToken("link-token"));
  assert.notEqual(hashPaymentToken("link-token"), "link-token");
  assert.equal(secureStringEqual("Bearer staff-key", "Bearer staff-key"), true);
  assert.equal(secureStringEqual("Bearer staff-key", "Bearer other-key"), false);
  assert.equal(secureStringEqual("x", undefined), false);
});

test("payment initiation uses the saved quote amount and currency, not client input", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  const token = "a".repeat(43);
  let providerPayload;
  process.env.PAWAPAY_ENV = "sandbox";
  process.env.PAWAPAY_API_TOKEN = "test-token";
  process.env.SUPABASE_URL = "https://db.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-key";
  process.env.PAYMENT_BASE_URL = "https://checkout.example.test";
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/pawapay_payment_links?token_hash=")) {
      return new Response(JSON.stringify([{
        id: "57bb023e-4857-4432-806b-8c0ea3b0ee9d",
        amount: "25000",
        currency: "UGX",
        reason: "AI video package",
        reference: "SIN-2026-014",
        status: "OPEN",
        expires_at: new Date(Date.now() + 3600000).toISOString()
      }]), { status: 200 });
    }
    if (target.includes("/rest/v1/pawapay_payment_links?id=eq.")) {
      return new Response(JSON.stringify([{ id: "57bb023e-4857-4432-806b-8c0ea3b0ee9d" }]), { status: 200 });
    }
    if (target.endsWith("/v2/payment-page/deposits")) {
      providerPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ status: "ACCEPTED", redirectUrl: "https://paywith.pawapay.io/session" }), { status: 200 });
    }
    throw new Error(`Unexpected request to ${target}`);
  };

  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await paymentStartHandler({
      method: "POST",
      headers: {},
      body: { token, amount: "0.01", currency: "USD", reason: "changed by browser" }
    }, response);
    assert.equal(response.code, 200);
    assert.equal(response.body.redirectUrl, "https://paywith.pawapay.io/session");
    assert.equal(providerPayload.amountDetails.amount, "25000");
    assert.equal(providerPayload.amountDetails.currency, "UGX");
    assert.equal(providerPayload.reason, "AI video package");
    assert.equal(providerPayload.metadata[0].invoiceReference, "SIN-2026-014");
    assert.match(providerPayload.depositId, /^[0-9a-f-]{36}$/i);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
