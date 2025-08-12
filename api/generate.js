// /api/generate.js
// Modes:
//  - "simple": 7 personas, returns 3 short options
//  - "advanced": long reply using sliders + scenario + intents

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

// --- Advanced composer ---
function buildAdvancedSystem(sl, intents = [], intentText = "") {
  const pct = (v)=>Math.max(0, Math.min(100, Number(v)||0));

  const politics = pct(sl.politics);
  const scispir  = pct(sl.scispir);
  const heat     = pct(sl.heat);
  const formality= pct(sl.formality);
  const empathy  = pct(sl.empathy);
  const direct   = pct(sl.direct);
  const humor    = pct(sl.humor);
  const roast    = pct(sl.roast);
  const optimism = pct(sl.optimism);
  const length   = pct(sl.length);

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
  const targetParagraphs = length < 30 ? 1 : length < 60 ? 3 : length < 80 ? 5 : 6;

  // Temperature heuristic
  const temp = length > 70 || (humor > 60 || roast > 60) ? 0.95
             : heat > 60 ? 0.9
             : 0.7;

  const objectiveLine = [
    ...intents.map(i => `- ${i}`),
    intentText && `- ${intentText}`
  ].filter(Boolean).join('\n');

  const system = `
You are FINAL ADVANCED: craft a single, long-form reply that sounds human, strategic, and original.
Write ${targetParagraphs} paragraph${targetParagraphs>1?'s':''} (blank line between paragraphs). Avoid bullets unless necessary.

Primary objective(s):
${objectiveLine || '- If no explicit intent is given, prioritize clarity, respect, and achieving a constructive outcome.'}

Style directives:
- ${style.join('\n- ')}

Rules:
- Align the tone and strategy with the objective(s) above.
- No emojis, hashtags, or @mentions.
- No profanity, slurs, or hateful content. Be sharp without targeting protected classes.
- Use concrete examples when helpful; avoid jargon.
- If aggression is present, de-escalate unless Heat is very high.
  `.trim();

  return { system, temperature: temp, max_tokens: 800 + Math.floor(length * 2) };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.socket?.remoteAddress || "unknown";
    if (!rateLimit(ip)) return res.status(429).json({ error: "Too many requests. Try again shortly." });

    const { mode } = req.body || {};
    if (!mode) return res.status(400).json({ error: "Missing mode" });

    let payload;

    if (mode === "simple") {
      const { text, tone } = req.body || {};
      if (!text || !tone) return res.status(400).json({ error: "Missing text/tone" });
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
      const { scenario, intentText = "", intents = [], sliders = {} } = req.body || {};
      if (!scenario) return res.status(400).json({ error: "Missing scenario" });

      const { system, temperature, max_tokens } = buildAdvancedSystem(sliders, intents, intentText);

      payload = {
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Scenario/context (respond as one cohesive reply tailored to the objectives):\n"""${scenario}"""` }
        ],
        temperature,
        max_tokens
      };
    } else {
      return res.status(400).json({ error: "Unknown mode" });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
    // advanced
    return res.status(200).json({ replies: stripOuterQuotes(raw) });

  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
