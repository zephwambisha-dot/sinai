import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseStatusAndId, verifyPawaPayCallback } from "../lib/pawapay-callback.js";

test("maps a deposit callback to a minimal payment record", () => {
  const record = parseStatusAndId({
    depositId: "c1eaa7d1-910e-4d69-b0ad-4dc669ec8cae",
    status: "COMPLETED",
    amount: "25000",
    currency: "UGX",
    country: "UGA",
    payer: { accountDetails: { phoneNumber: "256700000000" } }
  });
  assert.deepEqual(record, {
    transaction_id: "c1eaa7d1-910e-4d69-b0ad-4dc669ec8cae",
    operation_type: "DEPOSIT",
    status: "COMPLETED",
    amount: "25000",
    currency: "UGX",
    country: "UGA",
    provider_transaction_id: null,
    callback_created_at: null
  });
  assert.equal("payer" in record, false);
});

test("rejects callbacks with ambiguous IDs or invalid statuses", () => {
  assert.throws(() => parseStatusAndId({ depositId: "d1", payoutId: "p1", status: "COMPLETED" }));
  assert.throws(() => parseStatusAndId({ depositId: "d1", status: "" }));
});

function signedCallback({ body, privateKey, now }) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signatureDate = new Date(now * 1000).toISOString();
  const digest = `sha-256=:${crypto.createHash("sha256").update(rawBody).digest("base64")}:`;
  const params = `("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="HTTP_EC_P256_KEY:1";created=${now};expires=${now + 60}`;
  const headers = {
    host: "example.test",
    "signature-date": signatureDate,
    "content-digest": digest,
    "content-type": "application/json; charset=UTF-8",
    "signature-input": `sig-pp=${params}`
  };
  const base = [
    `"@method": POST`,
    `"@authority": ${headers.host}`,
    `"@path": /api/pawapay-callback`,
    `"signature-date": ${signatureDate}`,
    `"content-digest": ${digest}`,
    `"content-type": ${headers["content-type"]}`,
    `"@signature-params": ${params}`
  ].join("\n");
  const signer = crypto.createSign("sha256");
  signer.update(base);
  signer.end();
  headers.signature = `sig-pp=:${signer.sign(privateKey).toString("base64")}:`;
  return { headers, rawBody };
}

test("verifies a PawaPay RFC 9421 callback signature and body digest", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const { headers, rawBody } = signedCallback({
    body: { depositId: "d1", status: "COMPLETED" },
    privateKey,
    now
  });
  const oldFetch = globalThis.fetch;
  process.env.PAWAPAY_API_TOKEN = "test-only";
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: "HTTP_EC_P256_KEY:1",
    key: publicKey.export({ type: "spki", format: "pem" })
  }]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const request = { method: "POST", url: "/api/pawapay-callback", headers };
    assert.equal(await verifyPawaPayCallback(request, rawBody, now), true);
    await assert.rejects(verifyPawaPayCallback(request, Buffer.from(`${rawBody.toString()} `), now));
  } finally {
    globalThis.fetch = oldFetch;
    delete process.env.PAWAPAY_API_TOKEN;
  }
});
