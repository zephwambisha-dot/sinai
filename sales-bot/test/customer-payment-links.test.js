import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../api/customer-payment-links.js";

function makeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const config = {
  countries: [{ country: "UGA", displayName: { en: "Uganda" }, prefix: "256", providers: [{ currencies: [{
    currency: "UGX",
    operationTypes: { DEPOSIT: { status: "OPERATIONAL", minTransactionLimit: "500", maxTransactionLimit: "20000000", decimalsInAmount: "NONE" } }
  }] }] }]
};

test("starts a payment page from customer country, phone, and amount inputs", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  let inserted;
  let providerPayload;
  process.env.PAWAPAY_ENV = "sandbox";
  process.env.PAWAPAY_API_TOKEN = "sandbox-token";
  process.env.SUPABASE_URL = "https://db.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-key";
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/v2/active-conf?operationType=DEPOSIT")) {
      return new Response(JSON.stringify(config), { status: 200 });
    }
    if (target.endsWith("/rest/v1/pawapay_payment_links")) {
      inserted = JSON.parse(options.body);
      return new Response(null, { status: 201 });
    }
    if (target.endsWith("/v2/paymentpage")) {
      providerPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ status: "ACCEPTED", redirectUrl: "https://paywith.pawapay.io/session" }), { status: 200 });
    }
    if (target.includes("/rest/v1/pawapay_payment_links?deposit_id=eq.")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request to ${target}`);
  };

  const response = makeResponse();
  try {
    await handler({
      method: "POST",
      headers: { origin: "https://checkout.example.test", host: "checkout.example.test", "x-forwarded-for": crypto.randomUUID() },
      body: { country: "UGA", currency: "UGX", phoneNumber: "0772 123 456", amount: "1500" }
    }, response);
    assert.equal(response.code, 201);
    assert.equal(response.body.paymentUrl, "https://paywith.pawapay.io/session");
    assert.equal(response.body.amount, "1500");
    assert.equal(response.body.currency, "UGX");
    assert.match(response.body.reference, /^SIN-[A-F0-9]{8}$/);
    assert.equal(inserted.country, "UGA");
    assert.equal(inserted.phone_number, "256772123456");
    assert.equal(inserted.amount, "1500");
    assert.equal(inserted.currency, "UGX");
    assert.equal(inserted.provider_status, "INITIATING");
    assert.equal(inserted.manual_review_status, "PENDING");
    assert.equal(providerPayload.phoneNumber, "256772123456");
    assert.equal(providerPayload.country, "UGA");
    assert.equal(providerPayload.amountDetails.amount, "1500");
    assert.equal(providerPayload.amountDetails.currency, "UGX");
    assert.equal(providerPayload.metadata[0].invoiceReference, response.body.reference);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test("rejects invalid phone numbers without creating a payment", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  let paymentCreated = false;
  process.env.PAWAPAY_ENV = "sandbox";
  process.env.PAWAPAY_API_TOKEN = "sandbox-token";
  globalThis.fetch = async url => {
    if (String(url).endsWith("/v2/active-conf?operationType=DEPOSIT")) return new Response(JSON.stringify(config), { status: 200 });
    paymentCreated = true;
    throw new Error("Payment should not be created for an invalid number");
  };
  const response = makeResponse();
  try {
    await handler({
      method: "POST",
      headers: { origin: "https://checkout.example.test", host: "checkout.example.test", "x-forwarded-for": crypto.randomUUID() },
      body: { country: "UGA", currency: "UGX", phoneNumber: "abc", amount: "1500" }
    }, response);
    assert.equal(response.code, 400);
    assert.match(response.body.error, /phone/i);
    assert.equal(paymentCreated, false);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test("rejects cross-origin form posts before contacting providers", async () => {
  const oldFetch = globalThis.fetch;
  let contactedProvider = false;
  globalThis.fetch = async () => {
    contactedProvider = true;
    throw new Error("Provider should not be called");
  };
  const response = makeResponse();
  try {
    await handler({
      method: "POST",
      headers: { origin: "https://attacker.example", host: "checkout.example.test", "x-forwarded-for": crypto.randomUUID() },
      body: { country: "UGA", currency: "UGX", phoneNumber: "0772123456", amount: "1000" }
    }, response);
    assert.equal(response.code, 403);
    assert.equal(contactedProvider, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
