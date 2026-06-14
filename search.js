const https = require('https');

const EBAY_APP_ID = process.env.EBAY_APP_ID || 'TylersHo-MyCardTo-PRD-764b1d6fc-34685205';

function detectCondition(title) {
  const tl = (title || '').toLowerCase();
  if (tl.includes('psa 10')) return 'PSA 10';
  if (tl.includes('psa 9.5')) return 'PSA 9.5';
  if (tl.includes('psa 9')) return 'PSA 9';
  if (tl.includes('bgs 9.5')) return 'BGS 9.5';
  if (tl.includes('bgs 10')) return 'BGS 10';
  if (tl.includes('cgc 10')) return 'CGC 10';
  if (tl.includes('sgc 10')) return 'SGC 10';
  return 'Raw';
}

function fetchSoldListings(query) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    const path = [
      '/services/search/FindingService/v1',
      '?OPERATION-NAME=findCompletedItems',
      '&SERVICE-VERSION=1.13.0',
      `&SECURITY-APPNAME=${EBAY_APP_ID}`,
      '&RESPONSE-DATA-FORMAT=JSON',
      '&itemFilter(0).name=SoldItemsOnly',
      '&itemFilter(0).value=true',
      '&itemFilter(1).name=ListingType',
      '&itemFilter(1).value(0)=FixedPrice',
      '&itemFilter(1).value(1)=Auction',
      '&sortOrder=EndTimeSoonest',
      '&paginationInput.entriesPerPage=50',
      `&keywords=${q}`,
    ].join('');

    const options = {
      hostname: 'svcs.ebay.com',
      path,
      method: 'GET',
      headers: {
        'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
        'X-EBAY-SOA-SERVICE-VERSION': '1.13.0',
        'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
        'X-EBAY-SOA-SECURITY-APPNAME': EBAY_APP_ID,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
        'Accept': 'application/json',
        'User-Agent': 'SlabCheck/1.0 (slabcheck.cards)',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
          const sales = items
            .filter(i => i?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
            .map(i => ({
              title:     i?.title?.[0] || '',
              price:     parseFloat(i?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0),
              date:      (i?.listingInfo?.[0]?.endTime?.[0] || '').split('T')[0],
              condition: detectCondition(i?.title?.[0]),
              url:       i?.viewItemURL?.[0] || '#',
            }))
            .filter(s => s.price > 0)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
          resolve(sales);
        } catch(e) {
          reject(new Error(`Parse: ${data.substring(0,120)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    const sales = await fetchSoldListings(query);
    if (sales.length > 0) {
      return res.json(sales);
    }
    return res.json({ error: 'No sold listings found', demo: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
