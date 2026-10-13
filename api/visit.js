import { recordVisit } from "./_lib/stats.js";

// POST /api/visit  { visitorId }  - counts an anonymous page view. Always returns 204.
export default async function handler(req, res) {
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    await recordVisit(body && body.visitorId);
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(204).end();
}
