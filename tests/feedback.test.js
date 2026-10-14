import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import feedbackHandler, { parseFeedback } from "../api/feedback.js";

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

test("parseFeedback requires a message and trims inputs", () => {
  assert.equal(parseFeedback({ message: "   " }).error, "Message is required");
  assert.match(parseFeedback({ message: "x".repeat(2001) }).error, /at most/);
  const { entry, isBot } = parseFeedback({ message: " Nice site ", email: " a@b.co ", page: "/" });
  assert.equal(entry.message, "Nice site");
  assert.equal(entry.email, "a@b.co");
  assert.equal(isBot, false);
  assert.equal(parseFeedback({ message: "hi", website: "spam.example" }).isBot, true);
});

test("feedback is stored in Redis and returns 204", async () => {
  process.env.KV_REST_API_URL = "https://redis.test";
  process.env.KV_REST_API_TOKEN = "t";
  let sent = null;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => sent.map(() => ({ result: 1 })) };
  };
  const res = fakeRes();
  await feedbackHandler({ method: "POST", body: { message: "Great tool" } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(sent[0][0], "LPUSH");
  assert.equal(sent[0][1], "fc:feedback");
  assert.equal(JSON.parse(sent[0][2]).message, "Great tool");
});

test("feedback returns 503 when storage isn't configured, 400 when empty, 405 for GET", async () => {
  let res = fakeRes();
  await feedbackHandler({ method: "POST", body: { message: "hello" } }, res);
  assert.equal(res.statusCode, 503);
  res = fakeRes();
  await feedbackHandler({ method: "POST", body: { message: "" } }, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await feedbackHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
});

test("honeypot submissions are accepted but not stored", async () => {
  process.env.KV_REST_API_URL = "https://redis.test";
  process.env.KV_REST_API_TOKEN = "t";
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => [] }; };
  const res = fakeRes();
  await feedbackHandler({ method: "POST", body: { message: "buy now", website: "x" } }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(called, false);
});
