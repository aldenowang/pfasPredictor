import { readStats, statsEnabled } from "./_lib/stats.js";

// GET /api/stats?key=YOUR_STATS_KEY
// Private usage numbers. Only works when the STATS_KEY environment variable is set
// in Vercel, and the request includes the same key.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.STATS_KEY;
  if (!key) return res.status(404).json({ error: "Stats are not set up (STATS_KEY is missing)." });
  const given = (req.query && req.query.key) || "";
  if (given !== key) return res.status(401).json({ error: "Wrong or missing key." });
  if (!statsEnabled()) return res.status(503).json({ error: "Database is not connected." });

  const stats = await readStats(30);
  if (!stats) return res.status(502).json({ error: "Couldn't reach the database." });
  return res.status(200).json(stats);
}
