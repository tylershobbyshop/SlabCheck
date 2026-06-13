const https = require('https');

const EBAY_APP_ID = process.env.EBAY_APP_ID || 'TylersHo-MyCardTo-PRD-764b1d6fc-34685205';

function fetchEbaySold(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const path = `/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.13.0&SECURITY-APPNAME=${EBAY_APP_ID}&RESPONSE-DATA-FORMAT=JSON&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true&keywords=${encodedQuery}&paginationInput.entriesPerPage=50&sortOrder=EndTimeSoonest`;

    const options = {
      hostname: 'svcs.ebay.com',
      path,
      method: 'GET',
      headers: { 'User-Agent': 'SlabCheck/1.0' }
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
            .map(i => {
              const price = parseFloat(i?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0);
              const title = i?.title?.[0] || '';
              const endTime = i?.listingInfo?.[0]?.endTime?.[0] || '';
              const itemId = i?.itemId?.[0] || '';
              const url = i?.viewItemURL?.[0] || `https://www.ebay.com/itm/${itemId}`;
              const tl = title.toLowerCase();
              let condition = 'Raw';
              if (tl.includes('psa 10')) condition = 'PSA 10';
              else if (tl.includes('psa 9')) condition = 'PSA 9';
              else if (tl.includes('bgs 9.5')) condition = 'BGS 9.5';
              else if (tl.includes('bgs 10')) condition = 'BGS 10';
              else if (tl.includes('cgc 10')) condition = 'CGC 10';
              else if (tl.includes('sgc 10')) condition = 'SGC 10';
              return { title, price, date: endTime.split('T')[0], condition, url };
            })
            .filter(s => s.price > 0)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

          resolve(sales);
        } catch(e) {
          reject(new Error(`Parse error: ${e.message} — Raw: ${data.substring(0,200)}`));
        }
      });
    });

    req.on('error', e => reject(new Error(`Request error: ${e.message}`)));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const sales = await fetchEbaySold(query);
    res.json(sales);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
