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
          if (!j.access_token) throw new Error('No token: ' + d.slice(0,100));
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

function detectGrade(input) {
  const t = (typeof input === 'string' ? input : (input && input.title) || '').toLowerCase();
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
  const yearMatch = query.match(/20(\d{2})(?:-(\d{2}))?/);
  const queryYear = yearMatch ? yearMatch[0] : null;

  const search = await httpsGet(
    'api.cardsight.ai',
    `/v1/catalog/search?q=${encodeURIComponent(query)}&limit=20`,
    { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
  );

  // If CardSight is unreachable or returns nothing, bail early cleanly
  if (!search || (!search.results && !search.cards)) return null;
  let cards = search.results || search.cards || [];
  if (!cards.length) return null;

  if (queryYear) {
    const yearFiltered = cards.filter(c => c.year === queryYear);
    if (yearFiltered.length) cards = yearFiltered;
  }

  const qLower = query.toLowerCase();
  cards = cards.map(c => {
    let score = c.relevance || 0;
    if ((c.setName||'').toLowerCase() === 'base set') score += 2;
    if (qLower.includes('silver') && (c.parallelName||'').toLowerCase().includes('silver')) score += 3;
    if (qLower.includes('gold') && (c.parallelName||'').toLowerCase().includes('gold')) score += 3;
    const insertSets = ['deep space','dominance','fireworks','fractal','kaleidoscopic','global reach','talismen','instant impact','rising stars'];
    if (insertSets.some(s => (c.setName||'').toLowerCase().includes(s))) score -= 2;
    return { ...c, _score: score };
  }).sort((a,b) => b._score - a._score);

  const topIds = cards.slice(0, 3).map(c => c.id || c.card_id).filter(Boolean);
  if (!topIds.length) return null;

  const pricingResults = await Promise.all(
    topIds.map(id => httpsGet(
      'api.cardsight.ai',
      `/v1/pricing/${id}?period=90d&limit=30`,
      { 'X-API-Key': CARDSIGHT_KEY, 'Accept': 'application/json' }
    ))
  );

  let allRecords = [];
  let bestImage = null;

  for (const pricing of pricingResults) {
    if (!pricing) continue;
    const records = pricing.raw && pricing.raw.records ? pricing.raw.records
                  : pricing.records ? pricing.records
                  : pricing.sales ? pricing.sales : [];
    const cardName = (pricing.card && pricing.card.name) || '';
    const setInfo  = (pricing.card && pricing.card.set)
      ? `${pricing.card.set.year} ${pricing.card.set.release} #${pricing.card.number}` : '';

    for (const r of records) {
      if (r.image_url && (!bestImage || (r.title && r.title.toLowerCase().includes('psa 10')))) {
        bestImage = r.image_url;
      }
      const grade = detectGrade({ title: r.title || '' });
      allRecords.push({
        title:     r.title || `${setInfo} ${cardName}`.trim(),
        price:     parseFloat(r.price || 0),
        date:      ((r.date || '').split('T')[0]) || new Date().toISOString().split('T')[0],
        condition: grade !== 'Raw' ? grade : (r.grade || r.condition || 'Raw'),
        url:       r.url || '#',
        image:     r.image_url || null,
        isSold:    r.listing_type === 'auction' || r.listing_type === 'sold',
        source:    'cardsight',
      });
    }
  }

  if (!allRecords.length) return null;
  if (bestImage && allRecords.length) allRecords[0].image = bestImage;

  return allRecords.filter(r => r.price > 0);
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

    const mapItems = items => (items||[]).map(item => ({
      title: item.title||'',
      price: parseFloat((item.price && item.price.value) || 0),
      date: ((item.itemEndDate || new Date().toISOString())).split('T')[0],
      condition: item.condition || detectGrade(item.title),
      url: item.itemWebUrl||'#',
      image: (item.image && item.image.imageUrl) || (item.thumbnailImages && item.thumbnailImages[0] && item.thumbnailImages[0].imageUrl) || null,
      isSold: false,
      source: 'ebay',
    })).filter(s => s.price > 0 && !s.title.toLowerCase().includes('[digital]'));

    const listings = mapItems((allRes && allRes.itemSummaries) || []);
    const cheapest = mapItems((cheapRes && cheapRes.itemSummaries) || [])
      .filter(i => i.price >= 1 && !['lot','bundle','master set'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price).slice(0,5);

    return { listings, cheapest };
  } catch(e) {
    return { listings: [], cheapest: [] };
  }
}

// Supabase — fixed table name to match setup_database.sql (was 'sold_prices', should be 'card_prices')
const SUPABASE_URL = 'https://lukwsphqdorfxcmefrui.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1a3dzcGhxZG9yZnhjbWVmcnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDk5MDIsImV4cCI6MjA5NzEyNTkwMn0.9ir4EGztOM8HXLQGXrQtm2NzUOeCQfAUQpduteMj-F0';

async function saveToSupabase(query, records) {
  try {
    const rows = records.map(r => ({
      search_key:  query.toLowerCase().trim(),
      title:       r.title,
      price:       r.price,
      sold_date:   r.date,
      condition:   r.condition,
      url:         r.url,
      scraped_at:  new Date().toISOString(),
    }));
    const body = JSON.stringify(rows);
    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'lukwsphqdorfxcmefrui.supabase.co',
        path: '/rest/v1/card_prices',  // fixed: was 'sold_prices'
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
          'Content-Length': Buffer.byteLength(body),
        }
      }, (res) => { res.on('data',()=>{}); res.on('end', resolve); });
      req.on('error', resolve);
      req.write(body); req.end();
    });
  } catch(e) { /* non-fatal */ }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    // Try CardSight first for real historical sales data
    const csData = await searchCardSight(query);

    if (csData && csData.length > 0) {
      const cheapest = [...csData]
        .filter(i => !['lot','bundle'].some(w => i.title.toLowerCase().includes(w)))
        .sort((a,b) => a.price - b.price).slice(0,5);
      saveToSupabase(query, csData).catch(()=>{});
      return res.json({ listings: csData, cheapest, query, total: csData.length, dataType: 'cardsight', source: 'cardsight' });
    }

    // CardSight returned nothing — fall back to eBay Browse API (active listings)
    // This is current asking prices, not sold comps. Frontend labels it accordingly.
    const { listings, cheapest } = await getEbayListings(query);

    if (!listings.length) {
      return res.json({ listings: [], cheapest: [], query, total: 0, dataType: 'none', source: 'none' });
    }

    res.json({ listings, cheapest, query, total: listings.length, dataType: 'listed', source: 'ebay' });

  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
