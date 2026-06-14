const https = require('https');

// Credentials stored in Vercel environment variables
const EBAY_APP_ID  = process.env.EBAY_APP_ID  || '';
const EBAY_CERT_ID = process.env.EBAY_CERT_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

function getToken() {
  return new Promise((resolve, reject) => {
    if (cachedToken && Date.now() < tokenExpiry) return resolve(cachedToken);

    const creds = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
    const body  = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';

    const options = {
      hostname: 'api.ebay.com',
      path: '/identity/v1/oauth2/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.access_token) throw new Error('No token');
          cachedToken = json.access_token;
          tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } catch(e) { reject(new Error('Token error: ' + data.substring(0,100))); }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

function detectCondition(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('psa 10') || t.includes('gem mint')) return 'PSA 10';
  if (t.includes('psa 9.5')) return 'PSA 9.5';
  if (t.includes('psa 9')) return 'PSA 9';
  if (t.includes('bgs 9.5')) return 'BGS 9.5';
  if (t.includes('bgs 10')) return 'BGS 10';
  if (t.includes('cgc 10')) return 'CGC 10';
  if (t.includes('sgc 10')) return 'SGC 10';
  if (t.includes('psa') || t.includes('bgs') || t.includes('cgc') || t.includes('sgc')) return 'Graded';
  return 'Raw';
}

function ebaySearch(token, q, sort, limit) {
  return new Promise((resolve, reject) => {
    const path = `/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=${sort}`;
    const options = {
      hostname: 'api.ebay.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).itemSummaries || []); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function process(items) {
  return items.map(item => ({
    title:     item.title || '',
    price:     parseFloat(item.price?.value || 0),
    date:      (item.itemEndDate || new Date().toISOString()).split('T')[0],
    condition: item.condition || detectCondition(item.title),
    url:       item.itemWebUrl || '#',
  })).filter(s => s.price > 0);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=180');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const token = await getToken();
    const [newItems, cheapItems] = await Promise.all([
      ebaySearch(token, query, 'newlyListed', 50),
      ebaySearch(token, query, 'price', 10),
    ]);

    const listings = process(newItems);
    const cheapest = process(cheapItems)
      .filter(i => !['lot','bundle','master set'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price)
      .slice(0, 5);

    res.json({ listings, cheapest, query, total: listings.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
