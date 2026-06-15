const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lukwsphqdorfxcmefrui.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1a3dzcGhxZG9yZnhjbWVmcnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDk5MDIsImV4cCI6MjA5NzEyNTkwMn0.9ir4EGztOM8HXLQGXrQtm2NzUOeCQfAUQpduteMj-F0';

function supabaseRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL);
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: url.hostname,
      path: `/rest/v1/${path}`,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', e => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const key = query.toLowerCase().trim();

    // Check if we have cached data in Supabase
    const cached = await supabaseRequest(
      'GET',
      `card_prices?search_key=eq.${encodeURIComponent(key)}&order=sold_date.desc&limit=50`,
    );

    if (cached && cached.length > 0) {
      const listings = cached.map(r => ({
        title: r.title,
        price: r.price,
        date: r.sold_date,
        condition: r.condition,
        url: r.url,
      }));

      const cheapest = [...listings]
        .sort((a, b) => a.price - b.price)
        .slice(0, 5);

      return res.json({ listings, cheapest, query, total: listings.length, source: 'cache' });
    }

    // No data yet — return empty with a flag so frontend shows "no data yet" message
    return res.json({
      listings: [],
      cheapest: [],
      query,
      total: 0,
      source: 'empty',
      message: 'No data yet for this card. Check back soon as our database builds up!'
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
