// ============================================================
// SlabCheck — /api/search
//
// Pulls real eBay listing data via eBay's official Browse API.
//
// HONEST LIMITATION: this is current asking-price data (what's for
// sale right now), not sold/completed-transaction data. eBay no
// longer gives free programmatic access to true sold comps - the
// old Finding API's SoldItemsOnly is restricted for new developer
// apps, and the Browse API never had sold data to begin with.
// Scraping eBay's sold-listings HTML page was tried and abandoned:
// it's against eBay's ToS, actively hardened against bots, and
// impossible to verify/debug from this environment.
//
// What this gives instead, reliably: real prices, real titles,
// real working thumbnail images, fast and structured - all pulled
// straight from eBay's own JSON API rather than guessed-at HTML.
// ============================================================

const https = require('https');

const EBAY_APP_ID  = (process.env || {}).EBAY_APP_ID  || '';
const EBAY_CERT_ID = (process.env || {}).EBAY_CERT_ID || '';

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
          if (!json.access_token) throw new Error('No token: ' + data.substring(0,150));
          cachedToken = json.access_token;
          tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
          resolve(cachedToken);
        } catch(e) { reject(e); }
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
  if (t.includes('psa')||t.includes('bgs')||t.includes('cgc')||t.includes('sgc')) return 'Graded';
  return 'Raw';
}

function browseSearch(token, q, sort, limit) {
  return new Promise((resolve) => {
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
        catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// Real, working image URL straight from eBay's JSON - no guessing.
function getImage(item) {
  return (item.image && item.image.imageUrl)
      || (item.thumbnailImages && item.thumbnailImages[0] && item.thumbnailImages[0].imageUrl)
      || (item.additionalImages && item.additionalImages[0] && item.additionalImages[0].imageUrl)
      || '';
}

function processBrowse(items) {
  return items.map(item => ({
    title:     item.title || '',
    price:     parseFloat((item.price && item.price.value) || 0),
    date:      ((item.itemEndDate || new Date().toISOString())).split('T')[0],
    condition: item.condition || detectCondition(item.title),
    url:       item.itemWebUrl || '#',
    image:     getImage(item),
  })).filter(s => s.price > 0);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const token = await getToken();

    const [broadItems, cheapItems] = await Promise.all([
      browseSearch(token, query, 'newlyListed', 60),
      browseSearch(token, query, 'price', 10),
    ]);

    const listings = processBrowse(broadItems);

    const cheapest = processBrowse(cheapItems)
      .filter(i => !['lot','bundle','master set','collection'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price)
      .slice(0, 5);

    res.json({ listings, cheapest, query, total: listings.length, source: 'browse-api' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
