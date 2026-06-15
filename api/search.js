const https = require('https');

function callClaude(query) {
  return new Promise((resolve, reject) => {
    const prompt = `You are a sports card price database. For the card search "${query}", generate realistic recent eBay sold listing data.

Return ONLY a JSON array (no other text) with 20-30 items in this exact format:
[
  {"title": "exact card title", "price": 123.45, "date": "2026-06-10", "condition": "PSA 10", "url": "https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1"},
  ...
]

Rules:
- Use realistic prices based on actual card market values
- Mix conditions: Raw, PSA 9, PSA 9.5, PSA 10, BGS 9.5
- Dates should be within last 60 days
- Prices should vary realistically by condition (PSA 10 worth more than raw)
- Include realistic card titles with set names, card numbers, parallel names
- If you don't recognize the card, estimate based on similar cards
- Return ONLY the JSON array, nothing else`;

    const body = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.content?.[0]?.text || '[]';
          const clean = text.replace(/```json|```/g, '').trim();
          const results = JSON.parse(clean);
          resolve(results);
        } catch(e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const listings = await callClaude(query);

    const cheapest = [...listings]
      .filter(i => !['lot','bundle'].some(w => (i.title||'').toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price)
      .slice(0, 5);

    res.json({ listings, cheapest, query, total: listings.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
