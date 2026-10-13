import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanVisitorId, recordVisit, recordPrediction, readStats, statsEnabled } from "../api/_lib/stats.js";
import predictHandler from "../api/predict.js";
import statsHandler from "../api/stats.js";

const SAMPLE = { species: "Largemouth Bass", lengthMm: 350, elevationMi: 0.1, urbanMi: 2, militaryMi: 15, lat: 33.5, lon: -86.8, water: "R" };

// Tiny in-memory stand-in for the Upstash Redis REST pipeline endpoint.
function fakeRedis() {
  const db = new Map();
  const run = ([cmd, key, ...args]) => {
    switch (cmd) {
      case "INCR": db.set(key, String(Number(db.get(key) || 0) + 1)); return Number(db.get(key));
      case "GET": return db.has(key) ? db.get(key) : null;
      case "SADD": { const s = db.get(key) || new Set(); const had = s.has(args[0]); s.add(args[0]); db.set(key, s); return had ? 0 : 1; }
      case "SCARD": return (db.get(key) || new Set()).size;
      case "HINCRBY": { const h = db.get(key) || new Map(); h.set(args[0], (h.get(args[0]) || 0) + Number(args[1])); db.set(key, h); return h.get(args[0]); }
      case "HGETALL": return [...(db.get(key) || new Map())].flatMap(([k, v]) => [k, String(v)]);
      default: throw new Error("unsupported " + cmd);
    }
  };
  return async (url, opts) => {
    assert.ok(url.endsWith("/pipeline"));
    assert.equal(opts.headers.Authorization, "Bearer test-token");
    const cmds = JSON.parse(opts.body);
    return { ok: true, json: async () => cmds.map((c) => ({ result: run(c) })) };
  };
}

const realFetch = globalThis.fetch;
const saved = {};
beforeEach(() => {
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "STATS_KEY"]) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
const connect = () => { process.env.KV_REST_API_URL = "https://fake.upstash.io"; process.env.KV_REST_API_TOKEN = "test-token"; globalThis.fetch = fakeRedis(); };

function mockRes() {
  return { statusCode: 200, body: undefined, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, send(t) { this.body = t; return this; }, end() { return this; } };
}

test("visitor IDs are validated", () => {
  assert.equal(cleanVisitorId("1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"), "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed");
  assert.equal(cleanVisitorId("short"), null);
  assert.equal(cleanVisitorId("<script>alert(1)</script>"), null);
  assert.equal(cleanVisitorId(42), null);
});

test("does nothing (and never throws) when no database is configured", async () => {
  assert.equal(statsEnabled(), false);
  assert.equal(await recordVisit("abcdefgh-1234"), null);
  assert.equal(await recordPrediction("abcdefgh-1234", "Walleye"), null);
});

test("counts unique visitors once no matter how many visits", async () => {
  connect();
  for (let i = 0; i < 5; i++) await recordVisit("visitor-aaaa-1111");
  await recordVisit("visitor-bbbb-2222");
  const s = await readStats(3);
  assert.equal(s.totals.uniqueVisitors, 2);
  assert.equal(s.totals.pageViews, 6);
  assert.equal(s.lastDaysUTC[0].uniqueVisitors, 2);
});

test("counts predictions, users who predicted, and species", async () => {
  connect();
  await recordPrediction("visitor-aaaa-1111", "Walleye");
  await recordPrediction("visitor-aaaa-1111", "Walleye");
  await recordPrediction("visitor-bbbb-2222", "Bluegill");
  const s = await readStats(3);
  assert.equal(s.totals.predictions, 3);
  assert.equal(s.totals.usersWhoPredicted, 2);
  assert.deepEqual(s.predictionsBySpecies, { Walleye: 2, Bluegill: 1 });
});

test("/api/predict still answers when the database is down", async () => {
  process.env.KV_REST_API_URL = "https://fake.upstash.io"; process.env.KV_REST_API_TOKEN = "test-token";
  globalThis.fetch = async () => { throw new Error("network down"); };
  const res = mockRes();
  await predictHandler({ method: "POST", body: { ...SAMPLE, visitorId: "visitor-aaaa-1111" }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Math.abs(res.body.pfasPpb - 15.6297) < 5e-4);
});

test("/api/predict records a prediction when connected", async () => {
  connect();
  await predictHandler({ method: "POST", body: { ...SAMPLE, visitorId: "visitor-cccc-3333" }, query: {} }, mockRes());
  const s = await readStats(1);
  assert.equal(s.totals.predictions, 1);
  assert.equal(s.totals.usersWhoPredicted, 1);
});

test("/api/stats needs the right key", async () => {
  connect();
  let res = mockRes(); await statsHandler({ method: "GET", query: {} }, res);
  assert.equal(res.statusCode, 404); // no STATS_KEY set -> disabled
  process.env.STATS_KEY = "secret-key";
  res = mockRes(); await statsHandler({ method: "GET", query: { key: "wrong" } }, res);
  assert.equal(res.statusCode, 401);
  res = mockRes(); await statsHandler({ method: "GET", query: { key: "secret-key", format: "json" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok("totals" in res.body);
});

test("/api/stats shows a readable page and escapes species names", async () => {
  connect();
  process.env.STATS_KEY = "secret-key";
  await recordVisit("visitor-aaaa-1111");
  await recordPrediction("visitor-aaaa-1111", "<b>Walleye</b>");
  const res = mockRes();
  await statsHandler({ method: "GET", query: { key: "secret-key" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.match(res.body, /People who visited/);
  assert.match(res.body, /&lt;b&gt;Walleye&lt;\/b&gt;/);
  assert.doesNotMatch(res.body, /<b>Walleye<\/b>/);
});
