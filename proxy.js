// SlabCheck Backend Proxy
// Pulls real eBay sold listings and serves them to the frontend
// Deploy free on Render.com or Railway.app
//
// Setup:
// 1. npm install
// 2. Set environment variables (see .env.example)
// 3. Deploy to Render.com (free tier)

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const EBAY_APP_ID    = process.env.EBAY_APP_ID    || 'TylersHo-MyCardTo-PRD-764b1d6fc-34685205';
const EBAY_AUTH_TOKEN = process.env.EBAY_AUTH_TOKEN || 'v^1.1#i^1#p^3#r^1#I^3#f^0#t^Ul4xMF84OkFCNEEwOEU2Q0I1MzY4MUVCREIzQzkyRjM1NzRGMENBXzJfMSNFXjI2MA==';

// ── SEARCH ENDPOINT ───────────────────────────────────────────
app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const sales = await fetchEbaySold(query);
    res.json(sales);
  } catch(e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FETCH EBAY SOLD LISTINGS ──────────────────────────────────
function fetchEbaySold(query) {
  return new Promise((resolve, reject) => {
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<findCompletedItemsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
  <keywords>${escapeXml(query)}</keywords>
  <categoryId>261328</categoryId>
  <itemFilter>
    <name>SoldItemsOnly</name>
    <value>true</value>
  </itemFilter>
  <itemFilter>
    <name>ListingType</name>
    <value>AuctionWithBIN</value>
    <value>FixedPrice</value>
    <value>Auction</value>
  </itemFilter>
  <sortOrder>EndTimeSoonest</sortOrder>
  <paginationInput>
    <entriesPerPage>50</entriesPerPage>
    <pageNumber>1</pageNumber>
  </paginationInput>
  <outputSelector>SellerInfo</outputSelector>
</findCompletedItemsRequest>`;

    const options = {
      hostname: 'svcs.ebay.com',
      path: '/services/search/FindingService/v1',
      method: 'POST',
      headers: {
        'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
        'X-EBAY-SOA-OPERATION-NAME': 'findCompletedItems',
        'X-EBAY-SOA-SERVICE-VERSION': '1.13.0',
        'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
        'X-EBAY-SOA-SECURITY-APPNAME': EBAY_APP_ID,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xmlBody),
      }
    };

    const req = https.request(options, (ebayRes) => {
      let data = '';
      ebayRes.on('data', chunk => data += chunk);
      ebayRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

          const sales = items
            .filter(item => item?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
            .map(item => {
              const price   = parseFloat(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || 0);
              const title   = item?.title?.[0] || '';
              const endTime = item?.listingInfo?.[0]?.endTime?.[0] || '';
              const itemId  = item?.itemId?.[0] || '';
              const url     = item?.viewItemURL?.[0] || `https://www.ebay.com/itm/${itemId}`;

              // Detect condition from title
              let condition = 'Raw';
              const titleLower = title.toLowerCase();
              if (titleLower.includes('psa 10') || titleLower.includes('psa10')) condition = 'PSA 10';
              else if (titleLower.includes('psa 9') || titleLower.includes('psa9')) condition = 'PSA 9';
              else if (titleLower.includes('psa 8')) condition = 'PSA 8';
              else if (titleLower.includes('bgs 9.5') || titleLower.includes('bgs9.5')) condition = 'BGS 9.5';
              else if (titleLower.includes('bgs 10') || titleLower.includes('bgs10')) condition = 'BGS 10';
              else if (titleLower.includes('cgc 10') || titleLower.includes('cgc10')) condition = 'CGC 10';
              else if (titleLower.includes('cgc 9.5')) condition = 'CGC 9.5';
              else if (titleLower.includes('sgc 10')) condition = 'SGC 10';
              else if (titleLower.includes('graded') || titleLower.includes('gem mint')) condition = 'Graded';

              return {
                title,
                price,
                date: endTime.split('T')[0],
                condition,
                url,
                itemId,
              };
            })
            .filter(s => s.price > 0)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

          resolve(sales);
        } catch(e) {
          reject(new Error('Failed to parse eBay response'));
        }
      });
    });

    req.on('error', e => reject(e));
    req.write(xmlBody);
    req.end();
  });
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'SlabCheck API running', version: '1.0' });
});

app.listen(PORT, () => {
  console.log(`SlabCheck proxy running on port ${PORT}`);
});
