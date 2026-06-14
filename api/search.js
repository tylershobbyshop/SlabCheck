const https = require('https');

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

function scrapeEbay(query, sold) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    // LH_Sold=1&LH_Complete=1 = sold listings
    // LH_BIN=1 = Buy It Now active listings
    const soldParam = sold ? '&LH_Sold=1&LH_Complete=1' : '&LH_BIN=1';
    const sortParam = sold ? '&_sop=13' : '&_sop=15'; // 13=end date recent, 15=price low
    const path = `/sch/i.html?_nkw=${q}${soldParam}${sortParam}&_ipg=50&_sacat=261328`;

    const options = {
      hostname: 'www.ebay.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const results = [];

          // Extract listings using regex on eBay HTML
          // Match item blocks
          const itemRegex = /s-item__wrapper[^]*?s-item__info[^]*?<\/li>/g;

          // Price pattern - matches $1,234.56 or $12.34
          const priceRegex = /class="s-item__price"[^>]*>\s*<span[^>]*>\$([0-9,]+\.?[0-9]*)<\/span>/g;

          // Title pattern
          const titleRegex = /class="s-item__title"[^>]*><span[^>]*>([^<]+)<\/span>/g;

          // URL pattern
          const urlRegex = /href="(https:\/\/www\.ebay\.com\/itm\/[^"]+)"/g;

          // Date pattern for sold items
          const dateRegex = /class="s-item__ended-date"[^>]*>([^<]+)</g;

          // Extract all prices
          const prices = [];
          let pm;
          while ((pm = priceRegex.exec(data)) !== null) {
            const p = parseFloat(pm[1].replace(/,/g, ''));
            if (p > 0) prices.push(p);
          }

          // Extract all titles
          const titles = [];
          let tm;
          while ((tm = titleRegex.exec(data)) !== null) {
            const t = tm[1].trim();
            if (t && t !== 'Shop on eBay' && !t.includes('Opens in a new window')) {
              titles.push(t);
            }
          }

          // Extract all URLs
          const urls = [];
          let um;
          const urlsSeen = new Set();
          while ((um = urlRegex.exec(data)) !== null) {
            const u = um[1].split('?')[0]; // clean URL
            if (!urlsSeen.has(u)) {
              urlsSeen.add(u);
              urls.push(um[1]);
            }
          }

          // Extract dates for sold items
          const dates = [];
          let dm;
          while ((dm = dateRegex.exec(data)) !== null) {
            dates.push(dm[1].trim());
          }

          // Combine into results
          const count = Math.min(prices.length, titles.length);
          for (let i = 0; i < count; i++) {
            if (prices[i] && titles[i]) {
              results.push({
                title: titles[i],
                price: prices[i],
                date: dates[i] ? parseDate(dates[i]) : new Date().toISOString().split('T')[0],
                condition: detectCondition(titles[i]),
                url: urls[i] || `https://www.ebay.com/sch/i.html?_nkw=${q}`,
                sold: sold,
              });
            }
          }

          resolve(results);
        } catch(e) {
          reject(new Error('Scrape parse error: ' + e.message));
        }
      });
    });

    req.on('error', e => reject(new Error('Request error: ' + e.message)));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

function parseDate(dateStr) {
  // eBay formats: "Jun 10, 2026" or "May 28, 2026"
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch(e) {}
  return new Date().toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    // Fetch sold listings AND active listings in parallel
    const [sold, active] = await Promise.allSettled([
      scrapeEbay(query, true),
      scrapeEbay(query, false),
    ]);

    const soldItems   = sold.status   === 'fulfilled' ? sold.value   : [];
    const activeItems = active.status === 'fulfilled' ? active.value : [];

    // Find cheapest active listing
    const cheapestActive = activeItems.length
      ? activeItems.sort((a,b) => a.price - b.price).slice(0, 5)
      : [];

    // Sort sold by date
    const soldSorted = soldItems.sort((a,b) => new Date(b.date) - new Date(a.date));

    res.json({
      sold: soldSorted,
      active: cheapestActive,
      query,
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
