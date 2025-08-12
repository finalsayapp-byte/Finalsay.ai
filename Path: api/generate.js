// /api/generate.js
// Minimal serverless endpoint for FinalSay.ai
// - Cleans quotes/numbering
// - Basic per-IP rate limit (burst)

const WINDOW_MS = 60 * 1000;       // 1 minute window
const MAX_REQUESTS = 10;           // 10 requests per minute per IP
const buckets = new Map();         // in-memory (resets on cold start)

function rateLimit(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) { b.count = 0; b.ts = now; }
  b.count += 1;
  buckets.set(ip, b);
  return b.count <= MAX_REQUESTS;
}

function stripOuterQuotes(s = "") {
  return s.replace(/^["“”'`]+|["“”'`]+$/g, "");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // Basic rate limit by IP
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown";
    if (!rateLimit(ip)) {
      return res.status(429).json({ error: "Too many requests. Slow down a sec." });
    }

    const { text, tone } = req.body || {};
    if (!text || !tone) return res.status(400).json({ error: "Missing text/tone" });

    const prompt = `
You are FinalSay.ai, a witty reply generator.
Write THREE brief responses (1–2 sentences each), numbered 1–3.
Tone: ${tone}. Audience: social media thread.
Keep it sharp, human, quotable. No hashtags, no emojis.
Original post: """${text}"""
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // or another model you have access to
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 220,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || "";

    // Turn numbered lines into a clean array, de-quoted
    const cleaned = raw
      .split(/\n/)
      .map((s) => s.replace(/^\s*\d+\.\s*/, "").trim()) // remove "1. "
      .map(stripOuterQuotes)
      .filter(Boolean);

    return res.status(200).json({ replies: cleaned });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
