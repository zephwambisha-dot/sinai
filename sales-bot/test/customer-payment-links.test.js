import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../api/customer-payment-links.js";
import { hashPaymentToken } from "../lib/pawapay-payments.js";

function makeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const config = {
  countries: [{ providers: [{ currencies: [{
    currency: "UGX",
    operationTypes: { DEPOSIT: { status: "OPERATIONAL", minTransactionLimit: "500", maxTransactionLimit: "20000000" } }
  }] }] }]
};

test("creates a customer-entered quote link with a hashed random token", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  let inserted;
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
    throw new Error(`Unexpected request to ${target}`);
  };

  const response = makeResponse();
  try {
    await handler({
      method: "POST",
      headers: { origin: "https://checkout.example.test", host: "checkout.example.test", "x-forwarded-for": crypto.randomUUID() },
      body: { reference: "SIN-TEST-1", reason: "Sandbox payment test", amount: "1500", currency: "UGX" }
    }, response);
    assert.equal(response.code, 201);
    assert.equal(response.body.amount, "1500");
    assert.equal(response.body.currency, "UGX");
    assert.match(response.body.paymentUrl, /^https:\/\/checkout\.example\.test\/payment\.html\?token=/);
    const token = new URL(response.body.paymentUrl).searchParams.get("token");
    assert.match(token, /^[A-Za-z0-9_-]{40,60}$/);
    assert.equal(inserted.reference, "SIN-TEST-1");
    assert.equal(inserted.amount, "1500");
    assert.equal(inserted.currency, "UGX");
    assert.equal(inserted.token_hash, hashPaymentToken(token));
    assert.notEqual(inserted.token_hash, token);
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
      body: { reference: "SIN-TEST-2", reason: "Test", amount: "1000", currency: "UGX" }
    }, response);
    assert.equal(response.code, 403);
    assert.equal(contactedProvider, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
