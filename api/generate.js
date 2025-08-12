import { fetchSources } from './_sourcesUtil.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || (await req.json?.()) || {};
    const {
      mode = 'advanced',
      message = '',
      scenario = '',
      intentText = '',
      intents = [],
      sliders = {},
      directOnly = true,
      replyFormat = 'normal',
      adviceMode = false,
      wantSources = false,
      persona = 'General'
    } = body;

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const lengthHints = {
      short: 'Keep it to 1–2 tight sentences.',
      normal: 'Keep it to 3–6 concise sentences or 1–2 short paragraphs.',
      long: 'Allow 2–4 short paragraphs; still be concise.'
    };

    const tone = {
      heat: sliders.heat ?? 40,
      formality: sliders.formality ?? 55,
      empathy: sliders.empathy ?? 70,
      direct: sliders.direct ?? 65,
      humor: sliders.humor ?? 45,
      roast: sliders.roast ?? 35,
      optimism: sliders.optimism ?? 60
    };
    const styleDirectives = [
      tone.formality >= 70 ? 'formal' : (tone.formality <= 40 ? 'casual' : 'neutral'),
      tone.heat <= 25 ? 'calm' : (tone.heat >= 65 ? 'fiery' : 'steady'),
      tone.empathy >= 70 ? 'empathetic' : 'matter-of-fact',
      tone.direct >= 75 ? 'very direct' : (tone.direct <= 40 ? 'indirect' : 'direct'),
      tone.humor >= 70 ? 'lightly witty' : '',
      tone.roast >= 70 ? 'biting' : '',
      tone.optimism <= 35 ? 'grounded/realist' : (tone.optimism >= 70 ? 'optimistic' : 'balanced')
    ].filter(Boolean).join(', ');

    const baseLines = [];
    if (message) baseLines.push(`MESSAGE_TO_REPLY: ${message}`);
    if (scenario) baseLines.push(`SCENARIO: ${scenario}`);
    if (intentText) baseLines.push(`USER_INTENT: ${intentText}`);
    if (Array.isArray(intents) && intents.length) baseLines.push(`INTENT_TAGS: ${intents.join(', ')}`);
    baseLines.push(`STYLE: ${styleDirectives}. ${lengthHints[replyFormat] || lengthHints.normal}`);

    const systemReplyOnly =
      'You are FinalSay.ai, a reply engine that returns READY-TO-SEND messages. ' +
      'When direct mode is on, output ONLY the reply text to paste back. No analysis, no quotes, no preface.';

    const systemAdvice =
      'You are FinalSay.ai in ADVICE mode. Provide compact, actionable guidance tailored to the situation. ' +
      'Prefer bullet points. Be concrete. If medical/legal, add a brief note to consult a professional.';

    async function openai(messages, { temperature = 0.7, max_tokens = 500 } = {}) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature, max_tokens })
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      return j?.choices?.[0]?.message?.content?.trim() || '';
    }

    if (!adviceMode) {
      const lines = [...baseLines, 'RETURN: Only the reply text. No analysis. No preface. No quotes.'];
      let reply = await openai([{ role: 'system', content: systemReplyOnly }, { role: 'user', content: lines.join('\n') }], { max_tokens: 400 });
      reply = reply.replace(/^("|\')|("|\')$/g, '').replace(/^Here(’|')?s (a|the) reply:?/i, '').replace(/^(Reply|Response):?/i, '').trim();
      return res.status(200).json({ replies: [reply] });
    }

    // Advice + Sources
    const adviceLines = [...baseLines, 'RETURN: Provide 4–8 concise, actionable bullets tailored to the content and intent.'];
    const adviceText = await openai([{ role: 'system', content: systemAdvice }, { role: 'user', content: adviceLines.join('\n') }], { max_tokens: 600 });

    const topic = (message || intentText || scenario || '').slice(0, 240);
    const sources = wantSources ? await fetchSources({ persona, topic }) : [];
    return res.status(200).json({ replies: [adviceText], sources });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
