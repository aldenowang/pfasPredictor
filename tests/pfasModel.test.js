import { test } from "node:test";
import assert from "node:assert/strict";
import { predictPFAS } from "../api/_lib/pfasModel.js";
import handler from "../api/predict.js";

const SAMPLE = {
  species: "Largemouth Bass",
  lengthMm: 350,
  elevationMi: 0.1,
  urbanMi: 2.0,
  militaryMi: 15.0,
  lat: 33.5,
  lon: -86.8,
  water: "R",
};

// Paste the TEST prediction printed in Colab (scikit-learn) here.
const EXPECTED_FROM_COLAB = 15.6297;

test("matches the scikit-learn prediction from Colab (~3 decimals)", (t) => {
  if (EXPECTED_FROM_COLAB === null) {
    t.todo("set EXPECTED_FROM_COLAB to the TEST number printed in Colab");
    return;
  }
  const got = predictPFAS(SAMPLE);
  assert.ok(
    Math.abs(got - EXPECTED_FROM_COLAB) < 5e-4,
    `predictPFAS returned ${got}, Colab expected ${EXPECTED_FROM_COLAB}`
  );
});

// Minimal stand-in for Vercel's req/res objects.
function call(method, data) {
  const req = { method, body: method === "POST" ? data : undefined, query: method === "GET" ? data : {} };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  handler(req, res);
  return res;
}

test("POST /api/predict returns the same value as predictPFAS", () => {
  const res = call("POST", SAMPLE);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pfasPpb, predictPFAS(SAMPLE));
});

test("GET /api/predict accepts query-string inputs", () => {
  const query = Object.fromEntries(Object.entries(SAMPLE).map(([k, v]) => [k, String(v)]));
  const res = call("GET", query);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pfasPpb, predictPFAS(SAMPLE));
});

test("rejects bad inputs with 400", () => {
  const res = call("POST", { ...SAMPLE, water: "X", lengthMm: -5, lat: 200 });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.details.some((d) => d.startsWith("water")));
  assert.ok(res.body.details.some((d) => d.startsWith("lengthMm")));
  assert.ok(res.body.details.some((d) => d.startsWith("lat")));
});

test("rejects unsupported methods with 405", () => {
  assert.equal(call("DELETE", {}).statusCode, 405);
});
