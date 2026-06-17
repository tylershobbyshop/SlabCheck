const https = require('https');
const CARDSIGHT_KEY = '2955a9e7596c45d8809161768acafed9';

function httpsGet(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method:'GET', headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({raw:d}); } });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query.q || 'wembanyama prizm silver rc 136';

  const search = await httpsGet(
    'api.cardsight.ai',
    `/v1/catalog/search?q=${encodeURIComponent(q)}&limit=10`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  // Show all results so we can see what matched
  const results = search?.results || [];
  res.json({
    query: q,
    total: results.length,
    matches: results.map(r => ({
      id: r.id,
      name: r.name,
      year: r.year,
      release: r.releaseName,
      set: r.setName,
      parallel: r.parallelName,
      number: r.number,
      relevance: r.relevance,
    }))
  });
};
