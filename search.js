const https = require('https');

const EBAY_APP_ID = process.env.EBAY_APP_ID || 'TylersHo-MyCardTo-PRD-764b1d6fc-34685205';

function escapeXml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fetchEbaySold(query) {
  return new Promise((resolve, reject) => {
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
  <keywords>${escapeXml(query)}</keywords>
  <itemFilter><name>SoldItemsOnly</name><value>true</value></itemFilter>
  <sortOrder>EndTimeSoonest</sortOrder>
  <paginationInput><entriesPerPage>50</entriesPerPage></paginationInput>
</findCompletedItemsRequest>`;

    const options = {
      hostname: 'svcs.ebay.com',
      path: '/services/search/FindingService/v1',
      method: 'POST',
      headers: {
        'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
        'X-EBAY-SOA-SERVICE-VERSION': '1.13.0',
        'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
        'X-EBAY-SOA-SECURITY-APPNAME': EBAY_APP_ID,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xmlBody),
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
              return { title, price, date: endTime.split('T')[0], condition, url, itemId };
            })
            .filter(s => s.price > 0)
            .sort((a,b) => new Date(b.date) - new Date(a.date));
          resolve(sales);
        } catch(e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.write(xmlBody);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const sales = await fetchEbaySold(query);
    res.json(sales);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
