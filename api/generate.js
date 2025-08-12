// /api/generate.js
// Tone-locked personas for extreme differentiation + quote cleanup + light rate limit.

const WINDOW_MS = 60 * 1000;   // 1 minute
const MAX_REQUESTS = 12;       // per IP per minute
const buckets = new Map();     // in-memory (resets on cold start)

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

const PERSONAS = {
  "Savage": `You are SAVAGE MODE: a ruthless roast-master. Short, lethal, hilarious. Internet insult-comedy energy. No emojis, no hashtags. No slurs or hate speech. Punchy 1–2 sentences max.`,
  "Witty & Sarcastic": `You are WITTY & SARCASTIC: high-brow snark, clever wordplay, smug but charming. Dry humor. Keep it crisp. 1–2 sentences.`,
  "Inspirational & Profound": `You are INSPIRATIONAL & PROFOUND: reflective, poetic, emotionally resonant. Sounds quotable and human. No clichés. 1–2 sentences.`,
  "Playful Roast": `You are PLAYFUL ROAST: friendly teasing, late-night monologue vibe. Fun, safe, cheeky. 1–2 sentences.`,
  "Petty & Precise": `You are PETTY & PRECISE: surgical call-outs that dismantle weak points with receipts energy. Calm, meticulous. 1–2 sentences.`,
  "Diplomatic Assassin": `You are DIPLOMATIC ASSASSIN: polite tone that hides a knife. Respectful wording, undeniable subtext. 1–2 sentences.`,
  "Chaotic Genius": `You are CHAOTIC GENIUS: brilliant, strange, hyper-associative references that still land. Surprising but coherent. 1–2 sentences.`
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // Rate limit
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(ip)) return res.status(429).json({ error: "Too many requests. Try again in a few seconds." });

    const { text, tone } = req.body || {};
    if (!text || !tone) return res.status(400).json({ error: "Missing text/tone" });

    const persona = PERSONAS[tone] || PERSONAS["Witty & Sarcastic"];

    const system = `${persona}
Rules:
- Sound human. No generic “As an AI” phrasing.
- Write THREE options, numbered 1–3.
- Keep each 1–2 sentences, quotable, and distinct from each other.
- No emojis, no hashtags, no @mentions.
- Avoid profanity and anything hateful. Be sharp without targeting protected classes.`;

    const user = `Original post:
"""${text}"""`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // use whatever model you have access to
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.95,
        max_tokens: 240,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || "";

    // Clean into array
    const cleaned = raw
      .split(/\n/)
      .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
      .map(stripOuterQuotes)
      .filter(Boolean);

    return res.status(200).json({ replies: cleaned.slice(0, 3) });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
