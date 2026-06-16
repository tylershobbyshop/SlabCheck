const https = require('https');

function fetchItemPage(itemUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(itemUrl);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => { if(data.length < 500000) data += c; });
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(''));
      req.setTimeout(8000, () => { req.destroy(); resolve(''); });
      req.end();
    } catch(e) { resolve(''); }
  });
}

function extractSoldData(html, itemUrl) {
  const results = [];
  
  // Extract JSON-LD data
  const jsonLdMatches = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/g) || [];
  for (const match of jsonLdMatches) {
    try {
      const jsonStr = match.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      const data = JSON.parse(jsonStr);
      if (data.offers) {
        const offers = Array.isArray(data.offers) ? data.offers : [data.offers];
        for (const offer of offers) {
          if (offer.price && offer.priceCurrency === 'USD') {
            results.push({
              title: data.name || '',
              price: parseFloat(offer.price),
              date: offer.priceValidUntil || new Date().toISOString().split('T')[0],
              condition: data.itemCondition?.replace('http://schema.org/', '') || 'Used',
              url: itemUrl,
              source: 'jsonld'
            });
          }
        }
      }
    } catch(e) {}
  }

  // Extract lastSoldPrice from eBay page data
  const soldPriceMatch = html.match(/"lastSoldPrice"[^}]*"value":"([0-9.]+)"/);
  const soldDateMatch  = html.match(/"lastSoldDate":"([^"]+)"/);
  const titleMatch     = html.match(/<h1[^>]*class="[^"]*x-item-title__mainTitle[^"]*"[^>]*><span[^>]*>([^<]+)<\/span>/);
  
  if (soldPriceMatch) {
    results.unshift({
      title: titleMatch?.[1] || '',
      price: parseFloat(soldPriceMatch[1]),
      date: soldDateMatch?.[1]?.split('T')[0] || new Date().toISOString().split('T')[0],
      condition: 'Sold',
      url: itemUrl,
      source: 'lastSold'
    });
  }

  // Extract sold price history from page scripts
  const priceHistoryMatch = html.match(/"soldHistory":\s*\[([^\]]+)\]/);
  if (priceHistoryMatch) {
    try {
      const history = JSON.parse('[' + priceHistoryMatch[1] + ']');
      for (const h of history) {
        if (h.price) results.push({
          title: titleMatch?.[1] || '',
          price: parseFloat(h.price),
          date: h.date?.split('T')[0] || new Date().toISOString().split('T')[0],
          condition: 'Sold',
          url: itemUrl,
          source: 'history'
        });
      }
    } catch(e) {}
  }

  // Fallback: extract current price from page
  if (!results.length) {
    const priceMatch = html.match(/class="[^"]*x-price-primary[^"]*"[^>]*>.*?\$([0-9,]+\.?[0-9]*)/s);
    const titleFallback = html.match(/<title>([^<|]+)/);
    if (priceMatch) {
      results.push({
        title: titleFallback?.[1]?.trim() || '',
        price: parseFloat(priceMatch[1].replace(/,/g,'')),
        date: new Date().toISOString().split('T')[0],
        condition: 'Listed',
        url: itemUrl,
        source: 'current'
      });
    }
  }

  return results.filter(r => r.price > 0);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  const urls = req.query.urls ? req.query.urls.split(',').slice(0, 8) : [];
  if (!urls.length) return res.status(400).json({ error: 'No URLs provided' });

  try {
    const results = [];
    // Fetch pages in parallel
    const pages = await Promise.all(urls.map(u => fetchItemPage(decodeURIComponent(u))));
    
    for (let i = 0; i < pages.length; i++) {
      const sold = extractSoldData(pages[i], decodeURIComponent(urls[i]));
      results.push(...sold);
    }

    res.json({
      results: results.filter(r => r.price > 0),
      scraped: pages.filter(p => p.length > 1000).length,
      total: urls.length
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
