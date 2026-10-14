import { pipeline } from "./_lib/stats.js";

// POST /api/feedback  { message, email?, page?, website? }
//
// Stores anonymous feedback in the same Upstash Redis database as the usage counts
// (list "fc:feedback", newest first, last 1,000 kept). Nothing else is recorded:
// no IP address and no visitor ID. "website" is a hidden honeypot field that only
// bots fill in; those submissions are accepted silently and dropped.
//
// Read the feedback in the Upstash console:  LRANGE fc:feedback 0 -1
//
// Returns 204 on success, 400 for an empty or too-long message, 503 if the
// database isn't configured or can't be reached.

const MAX_MESSAGE = 2000;
const MAX_EMAIL = 120;
const KEEP = 1000;

export function parseFeedback(body) {
  if (!body || typeof body !== "object") return { error: "Missing body" };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { error: "Message is required" };
  if (message.length > MAX_MESSAGE) return { error: `Message must be at most ${MAX_MESSAGE} characters` };
  const email = typeof body.email === "string" ? body.email.trim().slice(0, MAX_EMAIL) : "";
  const page = typeof body.page === "string" ? body.page.slice(0, 100) : "";
  const isBot = typeof body.website === "string" && body.website.trim() !== "";
  return { entry: { message, email, page, at: new Date().toISOString() }, isBot };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  const { entry, isBot, error } = parseFeedback(body);
  if (error) return res.status(400).json({ error });
  if (isBot) return res.status(204).end();

  const saved = await pipeline([
    ["LPUSH", "fc:feedback", JSON.stringify(entry)],
    ["LTRIM", "fc:feedback", 0, KEEP - 1],
  ]);
  if (!saved) return res.status(503).json({ error: "Feedback storage is unavailable" });
  return res.status(204).end();
}
