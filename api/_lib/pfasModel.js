import { createRequire } from "node:module";

// Loaded with require (not a JSON import) so it works in plain Node and is traced
// into the Vercel function bundle. Lives under api/_lib so it is never served
// as a static file to browsers.
const model = createRequire(import.meta.url)("./pfas_trees.json");

const EARTH_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(a));
}

function nearbySites(sites, lat, lon, k) {
  const d = sites.map(([sLat, sLon, y]) => [haversineMiles(lat, lon, sLat, sLon), y]);
  d.sort((a, b) => a[0] - b[0]);
  const top = d.slice(0, k);
  let wSum = 0, wVal = 0, dSum = 0;
  for (const [di, y] of top) { const w = 1 / (di + 1); wSum += w; wVal += w * y; dSum += di; }
  return { pfas: wVal / wSum, lnDist: Math.log(dSum / top.length + 0.01) };
}

function waterCode(v) {
  v = String(v).trim().toUpperCase();
  return v.startsWith("G") ? "GL" : v.slice(0, 1);   // R, P, L, GL
}

function walkTree(t, x) {
  let n = 0;
  while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
  return t.v[n];
}

export function predictPFAS(
  { species, lengthMm, elevationMi, urbanMi, militaryMi, lat, lon, water },
  target = "Sample's PFAS (ppb)"
) {
  const m = model.models[target];
  const sp = species.trim();
  const group = model.species_list.includes(sp) && !model.rare.includes(sp) ? sp : "Other";
  const avg = model.species_avg_length_mm[sp];
  const nb = nearbySites(m.sites, lat, lon, model.k_neighbors);

  const feats = {
    rel_length: avg ? lengthMm / avg : 1.0,
    ln_urban: Math.log(urbanMi + 0.01),
    ln_military: Math.log(militaryMi + 0.01),
    [model.col_elev]: elevationMi,
    [model.col_lat]: lat,
    [model.col_lon]: lon,
    nearby_sites_pfas: nb.pfas,
    nearby_sites_ln_dist: nb.lnDist,
    [`species_group_${group}`]: 1,
    [`${model.col_water}_${waterCode(water)}`]: 1,
    [`source_${model.main_source}`]: 1,
  };
  // scikit-learn compares in 32-bit floats; Math.fround matches that exactly
  const x = m.columns.map((c) => Math.fround(feats[c] ?? 0));

  let sum = 0;
  for (const t of m.trees) sum += walkTree(t, x);
  return Math.expm1(sum / m.trees.length);   // ppb
}