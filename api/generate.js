export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || (await req.json?.());
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
      wantSources = false
    } = body || {};

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

    const lengthHints = {
      short: 'Keep it to 1–2 tight sentences.',
      normal: 'Keep it to 3–6 concise sentences or 1–2 short paragraphs.',
      long: 'Allow 2–4 short paragraphs; still be concise.'
    };
    const lengthHint = lengthHints[replyFormat] || lengthHints.normal;

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
    baseLines.push(`STYLE: ${styleDirectives}. ${lengthHint}`);

    const systemReplyOnly =
      'You are FinalSay.ai, a reply engine that returns READY-TO-SEND messages. ' +
      'When direct mode is on, DO NOT provide meta-advice, analysis, disclaimers, prefaces, or quotes. ' +
      'Output ONLY the reply text the user can paste back. No labels. No quotes. No “Here’s a reply:”.';

    const systemAdvice =
      'You are FinalSay.ai in ADVICE mode. Provide compact, actionable guidance tailored to the situation. ' +
      'Prefer bullet points. Be concrete. If medical/legal, include a short caution to consult a professional.';

    async function openaiChat(messages, { temperature = 0.7, max_tokens = 500 } = {}) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature, max_tokens })
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      return j?.choices?.[0]?.message?.content?.trim() || '';
    }

    // PATH A: Direct copy-ready reply
    if (!adviceMode) {
      const lines = [...baseLines, 'RETURN: Only the reply text. No analysis. No preface. No quotes. No emoji unless tone clearly calls for it.'];
      let reply = await openaiChat([{ role: 'system', content: systemReplyOnly }, { role: 'user', content: lines.join('\n') }], { max_tokens: 400 });
      reply = reply.replace(/^("|\')|("|\')$/g, '').replace(/^Here(?:’|')s (?:a|the) reply:?/i, '').replace(/^Reply:?/i, '').replace(/^Response:?/i, '').trim();
      return res.status(200).json({ replies: [reply] });
    }

    // PATH B: Advice + optional sources
    const adviceLines = [...baseLines,
      'RETURN: Provide 4–8 concise bullets of advice tailored to the content and user intent. Use plain language.'
    ];
    let adviceText = await openaiChat([{ role: 'system', content: systemAdvice }, { role: 'user', content: adviceLines.join('\n') }], { max_tokens: 600 });

    let sources = [];
    if (wantSources) {
      if (SERPAPI_KEY) {
        // Use SerpAPI to fetch real links from reputable domains
        const topic = await openaiChat([
          { role: 'system', content: 'Extract 3–6 high-signal search queries (separated by |) from the user context for evidence and best-practice references. No commentary.' },
          { role: 'user', content: baseLines.join('\n') }
        ], { temperature: 0.2, max_tokens: 120 });

        const queries = topic.split('|').map(s => s.trim()).filter(Boolean).slice(0, 5);
        const domainsAllow = ['nih.gov','who.int','cdc.gov','mayoClinic.org','stanford.edu','harvard.edu','cornell.edu','apa.org','ama-assn.org','law.cornell.edu','oecd.org','un.org','unicef.org','imf.org','worldbank.org','nature.com','science.org','jamanetwork.com','nejm.org','bmj.com','ftc.gov'];
        const domainParam = domainsAllow.join(',');
        const hits = [];

        for (const q of queries) {
          const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&num=5&serp_api_key=${SERPAPI_KEY}`;
          try {
            const r = await fetch(url);
            if (!r.ok) continue;
            const j = await r.json();
            const items = (j.organic_results || []).slice(0,5).map(it => ({
              title: it.title,
              url: it.link,
              domain: (it.link||'').split('/')[2]||''
            })).filter(x => x.url && domainsAllow.some(d => (x.domain||'').toLowerCase().endsWith(d.toLowerCase())));
            items.forEach(it => hits.push(it));
            if (hits.length >= 8) break;
          } catch {}
        }
        // Deduplicate by domain+title
        const seen = new Set();
        sources = hits.filter(h => {
          const k = (h.domain||'')+'|'+(h.title||'');
          if (seen.has(k)) return false; seen.add(k); return true;
        }).slice(0,8);
      } else {
        // Fallback: suggested sources (no external calls)
        const suggested = await openaiChat([
          { role: 'system', content: 'Suggest 4–8 reputable sources with homepage URLs and a precise Google search query for each. Format: Title — URL — Query. No extra text.' },
          { role: 'user', content: baseLines.join('\n') }
        ], { temperature: 0.3, max_tokens: 300 });

        sources = suggested.split('\n').map(line => {
          const [title, url, query] = line.split('—').map(s => (s||'').trim());
          if (!title || !url) return null;
          const domain = (url.split('/')[2]||'');
          return { title, url, domain, query };
        }).filter(Boolean).slice(0,8);
      }
    }

    return res.status(200).json({ replies: [adviceText], sources });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
