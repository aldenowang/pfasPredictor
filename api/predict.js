import { predictPFAS } from "./_lib/pfasModel.js";

// POST /api/predict  (JSON body)   or   GET /api/predict?species=...&lengthMm=...
//
// Inputs:
//   species      string, e.g. "Largemouth Bass"
//   lengthMm     fish length in mm (> 0)
//   lat, lon     decimal degrees
//   water        "R" (river), "P" (pond), "L" (lake) or "GL" (Great Lake)
//   elevationMi  elevation of the site, miles (>= 0)
//   urbanMi      distance to nearest urban area, miles (>= 0)
//   militaryMi   distance to nearest military base, miles (>= 0)
//
// Returns: { pfasPpb: number }
//
// The trained trees (api/_lib/pfas_trees.json) are only read here on the server;
// they are never sent to the browser.

const WATER_TYPES = ["R", "P", "L", "GL"];

export function parseInputs(src) {
  const errors = [];
  const num = (key, { min = -Infinity, max = Infinity, gt } = {}) => {
    const v = typeof src[key] === "string" ? Number(src[key].trim()) : src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${key} must be a number`);
      return undefined;
    }
    if (gt !== undefined && !(v > gt)) errors.push(`${key} must be greater than ${gt}`);
    if (v < min || v > max) errors.push(`${key} must be between ${min} and ${max}`);
    return v;
  };

  const species = typeof src.species === "string" ? src.species.trim() : "";
  if (!species) errors.push("species is required");

  const water = typeof src.water === "string" ? src.water.trim().toUpperCase() : "";
  if (!WATER_TYPES.includes(water)) errors.push(`water must be one of ${WATER_TYPES.join(", ")}`);

  const inputs = {
    species,
    water,
    lengthMm: num("lengthMm", { gt: 0 }),
    lat: num("lat", { min: -90, max: 90 }),
    lon: num("lon", { min: -180, max: 180 }),
    elevationMi: num("elevationMi", { min: 0 }),
    urbanMi: num("urbanMi", { min: 0 }),
    militaryMi: num("militaryMi", { min: 0 }),
  };
  return { inputs, errors };
}

export default function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Use GET or POST" });
  }

  let src = req.method === "POST" ? req.body : req.query;
  if (typeof src === "string") {
    try {
      src = JSON.parse(src);
    } catch {
      return res.status(400).json({ error: "Body must be valid JSON" });
    }
  }
  if (!src || typeof src !== "object") {
    return res.status(400).json({ error: "Missing inputs" });
  }

  const { inputs, errors } = parseInputs(src);
  if (errors.length) return res.status(400).json({ error: "Invalid inputs", details: errors });

  try {
    const pfasPpb = predictPFAS(inputs);
    if (!Number.isFinite(pfasPpb)) throw new Error("Model returned a non-finite value");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ pfasPpb });
  } catch (err) {
    return res.status(500).json({ error: "Prediction failed" });
  }
}
