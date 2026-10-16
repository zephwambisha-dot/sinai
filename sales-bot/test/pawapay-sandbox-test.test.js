import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/pawapay-sandbox-test.js";

function responseMock() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function requestMock({ method = "POST", headers = {}, body = {} } = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); }
  };
}

async function withEnv(values, callback) {
  const names = ["PAWAPAY_ENV", "PAWAPAY_API_TOKEN", "PAWAPAY_SANDBOX_TEST_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try { await callback(); }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("rejects non-POST methods", async () => {
  const response = responseMock();
  await handler(requestMock({ method: "GET" }), response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});

test("fails closed outside Sandbox and never calls the API", async () => {
  await withEnv({ PAWAPAY_ENV: "production", PAWAPAY_API_TOKEN: "live-token", PAWAPAY_SANDBOX_TEST_KEY: "a-test-key-that-is-long-enough" }, async () => {
    const previousFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
    try {
      const response = responseMock();
      await handler(requestMock(), response);
      assert.equal(response.statusCode, 503);
      assert.equal(called, false);
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("requires the separate sandbox test key", async () => {
  await withEnv({ PAWAPAY_ENV: "sandbox", PAWAPAY_API_TOKEN: "sandbox-token", PAWAPAY_SANDBOX_TEST_KEY: "a-test-key-that-is-long-enough" }, async () => {
    const response = responseMock();
    await handler(requestMock(), response);
    assert.equal(response.statusCode, 401);
  });
});

test("accepts a documented Uganda sandbox wallet and calls only Sandbox", async () => {
  await withEnv({ PAWAPAY_ENV: "sandbox", PAWAPAY_API_TOKEN: "sandbox-token", PAWAPAY_SANDBOX_TEST_KEY: "a-test-key-that-is-long-enough" }, async () => {
    const previousFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ status: "ACCEPTED" }), { status: 200 });
    };
    try {
      const response = responseMock();
      await handler(requestMock({
        headers: { "x-pawapay-test-key": "a-test-key-that-is-long-enough" },
        body: { phoneNumber: "256753456789", amount: "100" }
      }), response);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.environment, "sandbox");
      assert.equal(response.body.status, "ACCEPTED");
      assert.match(response.body.depositId, /^[\da-f-]{36}$/);
      assert.equal(captured.url, "https://api.sandbox.pawapay.io/v2/deposits");
      assert.equal(captured.options.headers.Authorization, "Bearer sandbox-token");
      const sent = JSON.parse(captured.options.body);
      assert.equal(sent.currency, "UGX");
      assert.equal(sent.amount, "100");
      assert.equal(sent.payer.accountDetails.provider, "MTN_MOMO_UGA");
      assert.equal(sent.payer.accountDetails.phoneNumber, "256753456789");
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("rejects real or unlisted phone numbers without calling PawaPay", async () => {
  await withEnv({ PAWAPAY_ENV: "sandbox", PAWAPAY_API_TOKEN: "sandbox-token", PAWAPAY_SANDBOX_TEST_KEY: "a-test-key-that-is-long-enough" }, async () => {
    const previousFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
    try {
      const response = responseMock();
      await handler(requestMock({
        headers: { "x-pawapay-test-key": "a-test-key-that-is-long-enough" },
        body: { phoneNumber: "256700000000", amount: "100" }
      }), response);
      assert.equal(response.statusCode, 400);
      assert.equal(called, false);
    } finally { globalThis.fetch = previousFetch; }
  });
});
