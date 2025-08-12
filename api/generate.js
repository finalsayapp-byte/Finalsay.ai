export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { text, tone } = req.body || {};
    if (!text || !tone) return res.status(400).json({ error: "Missing text/tone" });

    const prompt = `
You are FinalSay.ai, a witty reply generator.
Write THREE brief responses (1–2 sentences each), numbered 1–3.
Tone: ${tone}. Audience: social media thread.
Keep it sharp, human, and quotable. No hashtags, no emojis.
Original post: """${text}"""
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",   // use any model you have access to
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 220
      })
    });

    if (!r.ok) return res.status(500).json({ error: "OpenAI error", detail: await r.text() });
    const data = await r.json();
    res.status(200).json({ replies: data.choices?.[0]?.message?.content || "" });
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
