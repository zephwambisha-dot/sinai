import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("checkout country menu includes every country shown in the PawaPay screenshots", async () => {
  const script = await readFile(new URL("../pay.js", import.meta.url), "utf8");
  for (const code of ["BEN", "CMR", "CIV", "COD", "GAB", "KEN", "MOZ", "COG", "RWA", "SEN", "SLE", "UGA", "ZMB"]) {
    assert.match(script, new RegExp(`code: \\\"${code}\\\"`));
  }
});

test("checkout uses the SIN AI light palette and logo asset", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../pay.html", import.meta.url), "utf8"),
    readFile(new URL("../payment.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /\/assets\/sin-ai-logo\.svg/);
  assert.match(css, /--canvas: #f5f1e8/);
  assert.match(css, /--ink: #11100e/);
  assert.match(css, /\.portal-nav/);
});

test("customer form shows country-code example and no currency selector", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../pay.html", import.meta.url), "utf8"),
    readFile(new URL("../pay.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /Make payment here/);
  assert.match(html, /256 772 123 456/);
  assert.doesNotMatch(html, /currency-label|Select a currency/);
  assert.match(script, /country: country\.value/);
  assert.doesNotMatch(script, /currency:/);
});
