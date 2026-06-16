const https = require('https');
const CARDSIGHT_KEY = '2955a9e7596c45d8809161768acafed9';

function httpsGet(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method:'GET', headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { resolve({ status: res.statusCode, body: d }); });
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query.q || 'wembanyama prizm silver rc';

  const search = await httpsGet(
    'api.cardsight.ai',
    `/v1/catalog/search?q=${encodeURIComponent(q)}&limit=3`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  res.json({
    search_status: search.status,
    search_body: search.body.substring(0, 500),
    query: q
  });
};
