// Anonymous usage counting in Upstash Redis (REST API, no extra dependencies).
//
// Each browser gets a random ID (stored in its localStorage) the first time it
// visits. We store only that random ID and simple counters: no names, emails,
// IP addresses or locations.
//
// Keys:
//   fc:visitors            set of every visitor ID       -> unique visitors
//   fc:visitors:<day>      set of visitor IDs that day   -> daily unique visitors
//   fc:pageviews(:<day>)   counters
//   fc:predictions(:<day>) counters
//   fc:predictors(:<day>)  sets of visitor IDs that made a prediction
//   fc:species             hash: species -> number of predictions
//
// If the database isn't configured or is unreachable, every function quietly
// does nothing, so the site keeps working exactly the same.

const TIMEOUT_MS = 1500;

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function statsEnabled() {
  return config() !== null;
}

export function cleanVisitorId(v) {
  return typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
}

export function today(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

// Runs several Redis commands in one request. Returns the results, or null on any failure.
async function pipeline(commands) {
  const cfg = config();
  if (!cfg) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()).map((r) => r.result);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function recordVisit(visitorId) {
  const id = cleanVisitorId(visitorId);
  const day = today();
  const cmds = [["INCR", "fc:pageviews"], ["INCR", `fc:pageviews:${day}`]];
  if (id) cmds.push(["SADD", "fc:visitors", id], ["SADD", `fc:visitors:${day}`, id]);
  return pipeline(cmds);
}

export async function recordPrediction(visitorId, species) {
  const id = cleanVisitorId(visitorId);
  const day = today();
  const cmds = [["INCR", "fc:predictions"], ["INCR", `fc:predictions:${day}`]];
  if (typeof species === "string" && species.length <= 60) cmds.push(["HINCRBY", "fc:species", species, 1]);
  if (id) cmds.push(["SADD", "fc:predictors", id], ["SADD", `fc:predictors:${day}`, id]);
  return pipeline(cmds);
}

export async function readStats(days = 30) {
  const dayList = [];
  for (let i = 0; i < days; i++) dayList.push(today(new Date(Date.now() - i * 86400000)));
  const cmds = [
    ["SCARD", "fc:visitors"],
    ["GET", "fc:pageviews"],
    ["GET", "fc:predictions"],
    ["SCARD", "fc:predictors"],
    ["HGETALL", "fc:species"],
  ];
  for (const d of dayList) {
    cmds.push(["SCARD", `fc:visitors:${d}`], ["GET", `fc:pageviews:${d}`], ["GET", `fc:predictions:${d}`], ["SCARD", `fc:predictors:${d}`]);
  }
  const r = await pipeline(cmds);
  if (!r) return null;

  const n = (v) => Number(v) || 0;
  const speciesFlat = r[4] || [];
  const species = {};
  for (let i = 0; i < speciesFlat.length; i += 2) species[speciesFlat[i]] = n(speciesFlat[i + 1]);

  const daily = dayList.map((d, i) => {
    const b = 5 + i * 4;
    return { day: d, uniqueVisitors: n(r[b]), pageViews: n(r[b + 1]), predictions: n(r[b + 2]), usersWhoPredicted: n(r[b + 3]) };
  });

  return {
    totals: { uniqueVisitors: n(r[0]), pageViews: n(r[1]), predictions: n(r[2]), usersWhoPredicted: n(r[3]) },
    predictionsBySpecies: Object.fromEntries(Object.entries(species).sort((a, b) => b[1] - a[1])),
    lastDaysUTC: daily,
  };
}
