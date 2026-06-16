const https = require('https');

const CARDSIGHT_KEY = process.env.CARDSIGHT_KEY || '2955a9e7596c45d8809161768acafed9';
const _a = Buffer.from('VHlsZXJzSG8tTXlDYXJkVG8tUFJELTc2NGIxZDZmYy0zNDY4NTIwNQ==','base64').toString();
const _b = Buffer.from('UFJELTY0YjFkNmZjYjJhYS03N2Y4LTRjYjYtODY2Ni0xNWFl','base64').toString();
const EBAY_APP_ID  = ((process.env||{}).EBAY_APP_ID  ||'').trim() || _a;
const EBAY_CERT_ID = ((process.env||{}).EBAY_CERT_ID ||'').trim() || _b;

let ebayToken = null, ebayExpiry = 0;

function httpsGet(hostname, path, headers) {
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method:'GET', headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayExpiry) return ebayToken;
  return new Promise((resolve, reject) => {
    const creds = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
    const body  = 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope';
    const req = https.request({
      hostname: 'api.ebay.com', path: '/identity/v1/oauth2/token', method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (!j.access_token) throw new Error('No token');
          ebayToken = j.access_token;
          ebayExpiry = Date.now() + (j.expires_in - 60) * 1000;
          resolve(ebayToken);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', e => reject(e));
    req.write(body); req.end();
  });
}

function detectGrade(title) {
  const t = (title||'').toLowerCase();
  if (t.includes('psa 10')||t.includes('gem mint')) return 'PSA 10';
  if (t.includes('psa 9.5')) return 'PSA 9.5';
  if (t.includes('psa 9')) return 'PSA 9';
  if (t.includes('psa 8')) return 'PSA 8';
  if (t.includes('psa 7')) return 'PSA 7';
  if (t.includes('bgs 9.5')) return 'BGS 9.5';
  if (t.includes('bgs 10')) return 'BGS 10';
  if (t.includes('cgc 10')) return 'CGC 10';
  if (t.includes('sgc 10')) return 'SGC 10';
  if (t.includes('psa')||t.includes('bgs')||t.includes('cgc')||t.includes('sgc')) return 'Graded';
  return 'Raw';
}

async function searchCardSight(query) {
  // Step 1: search catalog
  const search = await httpsGet(
    'api.cardsight.ai',
    `/v1/catalog/search?q=${encodeURIComponent(query)}&limit=5`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  if (!search) return null;
  const cards = search.results || search.cards || [];
  if (!cards.length) return null;

  // Step 2: get pricing for top match
  const cardId = cards[0].id || cards[0].card_id;
  if (!cardId) return null;

  const pricing = await httpsGet(
    'api.cardsight.ai',
    `/v1/pricing/${cardId}?period=90d&limit=50`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  if (!pricing) return null;

  // Response format: pricing.raw.records
  const records = pricing.raw?.records || pricing.records || pricing.sales || [];
  if (!records.length) return null;

  const cardName = pricing.card?.name || cards[0].name || '';
  const setInfo  = pricing.card?.set ? `${pricing.card.set.year} ${pricing.card.set.release} #${pricing.card.number}` : '';

  return records.map(r => ({
    title:     r.title || `${setInfo} ${cardName}`,
    price:     parseFloat(r.price || 0),
    date:      (r.date || '').split('T')[0] || new Date().toISOString().split('T')[0],
    condition: r.grade || r.condition || detectGrade(r.title || ''),
    url:       r.url || '#',
    isSold:    r.listing_type === 'auction' || r.listing_type === 'sold',
    source:    r.source || 'cardsight',
  })).filter(r => r.price > 0);
}

async function getEbayListings(query) {
  try {
    const token = await getEbayToken();
    const q = encodeURIComponent(query);
    const [allRes, cheapRes] = await Promise.all([
      httpsGet('api.ebay.com', `/buy/browse/v1/item_summary/search?q=${q}&limit=50&sort=newlyListed`, {
        'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'Accept': 'application/json'
      }),
      httpsGet('api.ebay.com', `/buy/browse/v1/item_summary/search?q=${q}&limit=10&sort=price`, {
        'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'Accept': 'application/json'
      }),
    ]);

    const process = items => (items||[]).map(item => ({
      title: item.title||'', price: parseFloat(item.price?.value||0),
      date: (item.itemEndDate||new Date().toISOString()).split('T')[0],
      condition: item.condition||detectGrade(item.title), url: item.itemWebUrl||'#', isSold: false,
    })).filter(s => s.price > 0 && !s.title.toLowerCase().includes('[digital]'));

    const listings = process((allRes||{}).itemSummaries||[]);
    const cheapest = process((cheapRes||{}).itemSummaries||[])
      .filter(i => i.price >= 1 && !['lot','bundle','master set'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price).slice(0,5);

    return { listings, cheapest };
  } catch(e) {
    return { listings: [], cheapest: [] };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    // Try CardSight for real market data first
    const csData = await searchCardSight(query);

    if (csData && csData.length > 0) {
      const cheapest = [...csData]
        .filter(i => !['lot','bundle'].some(w => i.title.toLowerCase().includes(w)))
        .sort((a,b) => a.price - b.price).slice(0,5);
      return res.json({ listings: csData, cheapest, query, total: csData.length, dataType: 'cardsight' });
    }

    // Fall back to eBay Browse API
    const { listings, cheapest } = await getEbayListings(query);
    res.json({ listings, cheapest, query, total: listings.length, dataType: 'listed' });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
