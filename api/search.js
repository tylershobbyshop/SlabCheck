const https = require('https');

// ── eBay Browse API (current listings) ───────────────────────
const _a = Buffer.from('VHlsZXJzSG8tTXlDYXJkVG8tUFJELTc2NGIxZDZmYy0zNDY4NTIwNQ==','base64').toString();
const _b = Buffer.from('UFJELTY0YjFkNmZjYjJhYS03N2Y4LTRjYjYtODY2Ni0xNWFl','base64').toString();
const EBAY_APP_ID  = (process.env||{}).EBAY_APP_ID  || _a;
const EBAY_CERT_ID = (process.env||{}).EBAY_CERT_ID || _b;

// ── Supabase ──────────────────────────────────────────────────
const SUPABASE_URL = (process.env||{}).SUPABASE_URL || 'https://lukwsphqdorfxcmefrui.supabase.co';
const SUPABASE_KEY = (process.env||{}).SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1a3dzcGhxZG9yZnhjbWVmcnVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDk5MDIsImV4cCI6MjA5NzEyNTkwMn0.9ir4EGztOM8HXLQGXrQtm2NzUOeCQfAUQpduteMj-F0';

// ── Mac listener URL (ngrok tunnel) ──────────────────────────
const MAC_LISTENER = (process.env||{}).MAC_LISTENER || '';

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
        } catch(e) { reject(e); }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

function detectCondition(title) {
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

function httpsGet(hostname, path, headers) {
  return new Promise((resolve) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function httpPost(url, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      const req = https.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(true));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    } catch(e) { resolve(false); }
  });
}

async function getSoldFromSupabase(query) {
  const key = encodeURIComponent(query.toLowerCase().trim());
  const result = await httpsGet(
    'lukwsphqdorfxcmefrui.supabase.co',
    `/rest/v1/sold_prices?search_key=eq.${key}&order=sold_date.desc&limit=50`,
    {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    }
  );
  if (!Array.isArray(result) || !result.length) return null;
  return result.map(r => ({
    title: r.title,
    price: r.price,
    date: r.sold_date,
    condition: r.condition,
    url: r.url || '#',
    isSold: true,
  }));
}

async function getBrowseListings(query) {
  try {
    let token;
    try {
      token = await getToken();
    } catch(tokenErr) {
      console.error('Token error:', tokenErr.message);
      return { listings: [], cheapest: [], tokenError: tokenErr.message };
    }
    const q = encodeURIComponent(query);
    const [allRes, cheapRes] = await Promise.all([
      httpsGet('api.ebay.com', `/buy/browse/v1/item_summary/search?q=${q}&limit=50&sort=newlyListed&fieldgroups=EXTENDED`, {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
      }),
      httpsGet('api.ebay.com', `/buy/browse/v1/item_summary/search?q=${q}&limit=10&sort=price`, {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
      }),
    ]);

    const process = items => (items||[]).map(item => ({
      title: item.title || '',
      price: parseFloat(item.price?.value || 0),
      date: (item.itemEndDate || new Date().toISOString()).split('T')[0],
      condition: item.condition || detectCondition(item.title),
      url: item.itemWebUrl || '#',
      isSold: false,
    })).filter(s => s.price > 0);

    const listings = process((allRes||{}).itemSummaries).filter(i => !i.title.toLowerCase().includes('[digital]'));
    const cheapest = process((cheapRes||{}).itemSummaries)
      .filter(i => !i.title.toLowerCase().includes('[digital]') && i.price >= 1
        && !['lot','bundle','master set'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price)
      .slice(0, 5);

    return { listings, cheapest };
  } catch(e) {
    return { listings: [], cheapest: [] };
  }
}

async function pingMacListener(query) {
  if (!MAC_LISTENER) return;
  try {
    await httpPost(`${MAC_LISTENER}/scrape?q=${encodeURIComponent(query)}`, '{}');
  } catch(e) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    // Ping Mac listener in background (don't wait)
    pingMacListener(query);

    // Check Supabase for sold data first
    const soldData = await getSoldFromSupabase(query);

    if (soldData && soldData.length > 0) {
      // We have sold data — return it
      const cheapest = [...soldData]
        .filter(i => !['lot','bundle','master set'].some(w => i.title.toLowerCase().includes(w)))
        .sort((a,b) => a.price - b.price)
        .slice(0, 5);

      return res.json({
        listings: soldData,
        cheapest,
        query,
        total: soldData.length,
        dataType: 'sold',
      });
    }

    // No sold data yet — return current listings from eBay Browse API
    const browseResult = await getBrowseListings(query);
    const { listings, cheapest } = browseResult;
    res.json({ listings, cheapest, query, total: listings.length, dataType: 'listed', debug: browseResult.tokenError || null });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
