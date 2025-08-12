// /api/generate.js
// Supports two modes:
//  - mode: "simple"   -> uses 7 extreme personas, returns 3 short options
//  - mode: "advanced" -> builds a long, nuanced reply using slider parameters

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 12;
const buckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) { b.count = 0; b.ts = now; }
  b.count += 1; buckets.set(ip, b);
  return b.count <= MAX_REQUESTS;
}

function stripOuterQuotes(s = "") {
  return s.replace(/^["“”'`]+|["“”'`]+$/g, "");
}

// --- Simple personas ---
const PERSONAS = {
  "Savage": `You are SAVAGE MODE: ruthless roast-master. Short, lethal, hilarious. Internet insult-comedy energy. No emojis, no hashtags. No slurs or hate speech. Punchy 1–2 sentences max.`,
  "Witty & Sarcastic": `You are WITTY & SARCASTIC: high-brow snark, clever wordplay, smug but charming. Dry humor. Keep it crisp. 1–2 sentences.`,
  "Inspirational & Profound": `You are INSPIRATIONAL & PROFOUND: reflective, poetic, emotionally resonant. Sounds quotable and human. No clichés. 1–2 sentences.`,
  "Playful Roast": `You are PLAYFUL ROAST: friendly teasing, late-night monologue vibe. Fun, safe, cheeky. 1–2 sentences.`,
  "Petty & Precise": `You are PETTY & PRECISE: surgical call-outs with receipts energy. Calm, meticulous. 1–2 sentences.`,
  "Diplomatic Assassin": `You are DIPLOMATIC ASSASSIN: polite tone that hides a knife. Respectful wording, undeniable subtext. 1–2 sentences.`,
  "Chaotic Genius": `You are CHAOTIC GENIUS: brilliant, strange, hyper-associative references that still land. Surprising but coherent. 1–2 sentences.`
};

// --- Advanced prompt composer ---
function buildAdvancedSystem(sl) {
  const pct = (v)=>Math.max(0, Math.min(100, Number(v)||0));

  const politics = pct(sl.politics); // 0 left, 50 neutral, 100 right
  const scispir  = pct(sl.scispir);  // 0 science, 50 balanced, 100 spiritual
  const heat     = pct(sl.heat);     // 0 zen, 100 hot
  const formality= pct(sl.formality);// 0 casual, 100 formal
  const empathy  = pct(sl.empathy);  // 0 low, 100 high
  const direct   = pct(sl.direct);   // 0 indirect, 100 direct
  const humor    = pct(sl.humor);    // 0 dry, 100 absurd
  const roast    = pct(sl.roast);    // 0 off, 100 savage
  const optimism = pct(sl.optimism); // 0 cynical, 100 idealist
  const length   = pct(sl.length);   // 0 short, 100 long

  const style = [];

  // Political lens
  if (politics < 40) style.push(`Subtly reflect a progressive framing; avoid slogans; focus on policy impacts & compassion.`);
  else if (politics > 60) style.push(`Subtly reflect a conservative framing; avoid slogans; emphasize personal responsibility & stability.`);
  else style.push(`Keep political framing neutral and balanced; steelman the other side when relevant.`);

  // Science ↔ Spiritual
  if (scispir < 40) style.push(`Anchor reasoning in evidence, data, and clear logic. Avoid mystical language.`);
  else if (scispir > 60) style.push(`Allow tasteful spiritual language, archetypes, and meaning-making alongside practical insight.`);
  else style.push(`Blend scientific clarity with gentle meaning-making without sounding woo.`);

  // Heat
  if (heat < 40) style.push(`Stay calm and centered; de-escalate conflict where possible.`);
  else if (heat > 60) style.push(`Increase rhetorical force and urgency without profanity or hate.`);

  // Formality
  if (formality < 40) style.push(`Use casual, conversational phrasing.`);
  else if (formality > 60) style.push(`Use crisp, professional phrasing.`);

  // Empathy
  if (empathy < 40) style.push(`Keep empathy minimal; prioritize clarity over comfort.`);
  else if (empathy > 60) style.push(`Show high empathy; validate feelings without pandering.`);

  // Directness
  if (direct < 40) style.push(`Use indirect, face-saving language when challenging points.`);
  else if (direct > 60) style.push(`Be direct and unambiguous, but not cruel.`);

  // Humor
  if (humor < 40) style.push(`Keep humor very dry and subtle.`);
  else if (humor > 60) style.push(`Allow playful wit and occasional absurd turns that remain coherent.`);

  // Roast
  if (roast < 40) style.push(`Avoid roast or sarcasm.`);
  else if (roast > 60) style.push(`Permit sharp, non-hateful roast lines used sparingly for impact.`);

  // Optimism
  if (optimism < 40) style.push(`Maintain a skeptical, reality-check tone without nihilism.`);
  else if (optimism > 60) style.push(`Maintain a hopeful, possibility-oriented tone without naivety.`);

  // Length
  const targetSentences = length < 30 ? 2
    : length < 60 ? 4
    : length < 80 ? 6
    : 8;

  const temp = length > 70 || (humor > 60 || roast > 60) ? 0.95
             : heat > 60 ? 0.9
             : 0.7;

  const system = `
You are FINAL ADVANCED: Craft a single, long-form reply that sounds human and original.
Write ${targetSentences} well-structured paragraph${targetSentences>1?'s':''} (line breaks between paragraphs). Avoid bullet lists unless necessary.

Style directives:
- ${style.join('\n- ')}

Rules:
- No emojis, no hashtags, no @mentions.
- No profanity, slurs, or hateful content. Be sharp without targeting protected classes.
- Use concrete examples when helpful. Prefer clear sentences over jargon.
- If the message is aggressive, de-escalate unless "Heat" is very high.
  `.trim();

  return { system, temperature: temp, max_tokens: 600 + Math.floor(length * 2) }; // generous room for long output
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(ip)) return res.status(429).json({ error: "Too many requests. Try again shortly." });

    const { mode, text } = req.body || {};
    if (!text || !mode) return res.status(400).json({ error: "Missing mode/text" });

    let payload;
    if (mode === "simple") {
      const { tone } = req.body;
      const persona = PERSONAS[tone] || PERSONAS["Witty & Sarcastic"];
      const system = `${persona}
Rules:
- Sound human. No “As an AI”.
- Write THREE options, numbered 1–3.
- Each 1–2 sentences, quotable, distinct from one another.
- No emojis, no hashtags, no @mentions.
- Avoid profanity and anything hateful. Be sharp without targeting protected classes.`;
      payload = {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Original message:\n"""${text}"""` }
        ],
        temperature: 0.95,
        max_tokens: 240
      };
    } else if (mode === "advanced") {
      const sliders = req.body.sliders || {};
      const { system, temperature, max_tokens } = buildAdvancedSystem(sliders);
      payload = {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Original message (respond as one cohesive reply):\n"""${text}"""` }
        ],
        temperature,
        max_tokens
      };
    } else {
      return res.status(400).json({ error: "Unknown mode" });
    }

    // Call OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // adjust to your available model
        ...payload
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI error", detail });
    }

    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || "";

    if (mode === "simple") {
      const cleaned = raw.split(/\n/)
        .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
        .map(stripOuterQuotes)
        .filter(Boolean)
        .slice(0, 3);
      return res.status(200).json({ replies: cleaned });
    }
    // advanced -> return as single string (the front-end displays as one long reply)
    return res.status(200).json({ replies: stripOuterQuotes(raw) });

  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
