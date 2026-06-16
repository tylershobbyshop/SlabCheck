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
  
  // Use the first card ID from previous test
  const cardId = req.query.id || 'b1ad1c19-b247-4f40-a4d6-769417927a12';

  const pricing = await httpsGet(
    'api.cardsight.ai',
    `/v1/pricing/${cardId}?period=90d&limit=10`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  res.json({
    pricing_status: pricing.status,
    pricing_body: pricing.body.substring(0, 1000),
    card_id: cardId
  });
};
