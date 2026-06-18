// ============================================================
// SlabCheck — /api/search
//
// "listings"  -> real SOLD comps, scraped directly off eBay's own
//                sold-listings search page (eBay's APIs no longer
//                give free sold/completed-item data to new apps —
//                Finding API's SoldItemsOnly is restricted, Browse
//                API only ever returns active listings).
// "cheapest"  -> real ACTIVE listings (genuinely for sale right now),
//                pulled from eBay's official Browse API — kept as-is,
//                this part was always honest.
//
// KNOWN TRADEOFFS (be aware, not swept under the rug):
//  - Scraping eBay's HTML is against their Terms of Service.
//  - eBay can change page markup at any time and silently break this.
//  - Vercel's serverless IPs may get rate-limited/blocked faster than
//    a residential IP would. If that happens this falls back to demo
//    data automatically rather than showing an error page.
// ============================================================

const https = require('https');

const EBAY_APP_ID  = (process.env || {}).EBAY_APP_ID  || '';
const EBAY_CERT_ID = (process.env || {}).EBAY_CERT_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

// ── OAuth token for the Browse API (active/"cheapest" listings) ──
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
          if (!json.access_token) throw new Error('No token: ' + data.substring(0,100));
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

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
}

// ── Plain HTTPS GET with a real-browser header set + manual cookie jar ──
function httpGet(hostname, path, cookieHeader) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity', // avoid gzip/brotli decompression headaches
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ body: data, headers: res.headers, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Scrape eBay's own SOLD listings search page ──
async function scrapeSold(query) {
  const q = encodeURIComponent(query);

  // Warm a session first — a bare request with no cookies is more likely
  // to get an interstitial / stripped-down page.
  let cookieHeader = '';
  try {
    const home = await httpGet('www.ebay.com', '/');
    const setCookies = home.headers['set-cookie'] || [];
    cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ');
  } catch (e) { /* non-fatal, continue without cookies */ }

  const path = `/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_ipg=60&_sop=13`;
  const res = await httpGet('www.ebay.com', path, cookieHeader);

  if (res.status !== 200) {
    throw new Error(`eBay returned status ${res.status}`);
  }

  const html = res.body;

  // Each result sits in an <li class="s-item ..."> block.
  const itemBlocks = html.match(/<li class="s-item[^"]*">[\s\S]*?<\/li>/g) || [];

  const sales = [];
  for (const block of itemBlocks) {
    // Title
    const titleMatch = block.match(/class="s-item__title"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';
    if (!title || /^shop on ebay$/i.test(title)) continue; // skip eBay's placeholder tile

    // Price (first one in the block is the listing price)
    const priceMatch = block.match(/class="s-item__price"[^>]*>[\s\S]*?\$\s?([\d,]+\.\d{2})/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g,'')) : 0;
    if (!price) continue;

    // Sold date — eBay shows it in a caption like "Sold  Jun 12, 2026"
    const dateMatch = block.match(/s-item__(?:title--tagblock|caption)[^>]*>[\s\S]*?Sold\s*([A-Za-z]{3}\s\d{1,2},\s\d{4})/);
    let soldDate = new Date().toISOString().split('T')[0];
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed)) soldDate = parsed.toISOString().split('T')[0];
    }

    // Link
    const linkMatch = block.match(/class="s-item__link"\s+href="([^"]+)"/);
    const url = linkMatch ? linkMatch[1] : '#';

    sales.push({
      title,
      price,
      date: soldDate,
      condition: detectCondition(title),
      url,
    });
  }

  return sales
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0, 60);
}

// ── Browse API — active "buy it now" listings (cheapest tab) ──
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

function processBrowse(items) {
  return items.map(item => ({
    title:     item.title || '',
    price:     parseFloat(item.price?.value || 0),
    date:      (item.itemEndDate || new Date().toISOString()).split('T')[0],
    condition: item.condition || detectCondition(item.title),
    url:       item.itemWebUrl || '#',
  })).filter(s => s.price > 0);
}

// ── Demo fallback (only used if the scrape comes back empty/blocked) ──
function demo(query) {
  const base = Math.random() * 150 + 10;
  return Array.from({length: 20}, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i * 3);
    const v = (Math.random() - 0.4) * 0.25;
    const conds = ['Raw','Raw','Raw','PSA 10','PSA 9','BGS 9.5'];
    return {
      title: `${query} Card`,
      price: parseFloat((base * (1 + v)).toFixed(2)),
      date: d.toISOString().split('T')[0],
      condition: conds[Math.floor(Math.random() * conds.length)],
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1`,
    };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 min — be gentle on eBay

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  let listings = [];
  let source = 'live-scrape';

  try {
    listings = await scrapeSold(query);
  } catch (e) {
    console.error('Scrape failed:', e.message);
  }

  if (!listings.length) {
    listings = demo(query);
    source = 'demo-fallback';
  }

  // Active "cheapest right now" listings — Browse API, unrelated to the
  // sold-comp scrape above, so failures here don't block sold results.
  let cheapest = [];
  try {
    const token = await getToken();
    const cheapItems = await browseSearch(token, query, 'price', 10);
    cheapest = processBrowse(cheapItems)
      .filter(i => !['lot','bundle','master set','collection'].some(w => i.title.toLowerCase().includes(w)))
      .sort((a,b) => a.price - b.price)
      .slice(0, 5);
  } catch (e) {
    console.error('Browse (cheapest) failed:', e.message);
  }

  res.json({ listings, cheapest, query, total: listings.length, source });
};
