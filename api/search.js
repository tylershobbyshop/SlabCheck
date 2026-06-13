const https = require('https');

const EBAY_TOKEN = process.env.EBAY_TOKEN || 'v^1.1#i^1#I^3#f^0#p^1#r^0#t^H4sIAAAAAAAA/+VYe2wURRi/7YsWCkJKihAhx4KaqLc3+7jr3do7PPqQEq4tvYNgjSFzu7Pt0n0cO7u054tSUgyR+AeSaNRESCpvwcQoQYzloQYQiahI+EMk2ijGYIJ/CBFjnL2W0lYCSI/YxPvnMt98883v+833mB3QWVTy0LoF6y5PpMblbe4EnXkUxU4AJUWFD0/Kz5tR6AFDFKjNnXM7C7ryL1RiqGtpsQnhtGlg5O3QNQOLWWGEdixDNCFWsWhAHWHRlsRELL5I5Bggpi3TNiVTo7111RFa4AUAUxVIASgIpBAkUuOazaQZoQMCJwSRoFSgFAjzqRCZx9hBdQa2oWFHaA5wQR8I+lg+yfFiICCCEBPiQTPtXYosrJoGUWEAHc3CFbNrrSFYbw4VYowsmxiho3Wx2kRDrK66pj5Z6R9iKzrAQ8KGtoOHj6pMGXmXQs1BN98GZ7XFhCNJCGPaH+3fYbhRMXYNzB3Az1ItAcDCoMApQEqlOCE3VNaalg7tm+NwJarsU7KqIjJs1c7cilHCRmoFkuyBUT0xUVftdf8WO1BTFRVZEbpmfuyJWGMjHU1mNAJxgemLZ6qgJSdNX2NTta8iKKRYOahIPl4IhgIcCAxs1G9tgOYRO1WZhqy6pGFvvWnPRwQ1GsmNMIQbotRgNFgxxXYRDeoJScBe45Bjm91D7T9Fx2413HNFOiHCmx3e+gQGV9u2paYcGw1aGDmRpShCw3RalemRk9lYHAifDhyhW207Lfr97e3tTDvPmFaLnyMx4l8WX5SQWpFOkrFDd3O9X1+99QKfmnVFQmQlVkU7kyZYOkisEgBGCx0NVLAsyw3wPhxWdKT0H4IhPvuHZ0SuMoSFFUEYVkJsgAdQYGEuMiQ6EKR+FwdKwYxPh1YbstMalJBPInHm6MhSZZEPKBwfUpBPDoYVnxBWFF8qIJPNFIQAQqmUFA79nxLldkM9gSQL2TmJ9ZzFeaYF4cDj8ZWQW6EqDYtXJmuTVdx8q10Q2i3NgTVOc9XCZXE9E2djkdvNhhs6X6WphJkk2T8XBLi5njsSFpjYRvKo3EtIZho1mpoqZcbWAfOW3AgtO5NAmkYEo3Iylk7X5aZW58y9f1km7szv3PWo/6g/3dAr7Ibs2PLKXY+JAZhWGbcDMZKp+91cNyG5frji5VnU3hsqjlDyExlpWBJiSF+SU1BqYywEZdPQMqPiTSU33zHFGvGznwRV7r+yMlkmGLxKIh5j0yEcYKbBvcElzTZkkH5oW6ZGEmcpO+p6oOuODVMaGmuFIQcJosIx1qzZihDLh4UwCI3KLynbipePtZLmlvKCLgre9XLehKCmjy3f05YpO5J7R70Lnxz+4Q8gUU/2x3ZRh0EX9VEeRYFKcD87B8wuyl9SkF86A6s2YlSoMFhtMch3vYWYNpRJQ9XKK/McP322ftaBhdvX903r7J7r3+iZNOT9ZfNT4N7BF5iSfHbCkOcYcN/1mUL2nmkTuSAIsjzHBwIg1AzmXJ8tYMsLpj545JWvome/7WqjL/Z4DtUfPbL35PNg4qASRRV6SLB4jBc3HZi3a9nsjWblqj87mPeuvLC19Fis7JGVV1v5qdrH03e8rJ1dvWHLmaKvf13T0+OlXnpj/7zt3XsOX+41Jq+vLtb6GracYPom7372r31f1OtFp0p/Dsx++62kvzo+eW0x//vBkjPOzP2zEh7fk1RJ057SVcd3vVn0zGvj3t1xZPr21d87hz/1jGvrC5f2tjhXx5/Me/XAvu8ovfX9mZ9cmjT+WO+5Xe2974g/PXcp+FimtSBZv3x3edPTX66Z8vovyqlz3xzySEt+21s+q3Vx3bbiqj+mlFGfVW/aGe/4sfzzzpqenapxseuH7qNyWfFahj0a3/bABzPP71j96IYTp7eGP+zOHAxfOXTh3Pn+s/wb8kWdJRkTAAA=';

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

function fetchEbay(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const path = `/buy/browse/v1/item_summary/search?q=${encodedQuery}&filter=buyingOptions:{FIXED_PRICE},conditions:{USED|NEW}&sort=endingSoonest&limit=50`;

    const options = {
      hostname: 'api.ebay.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${EBAY_TOKEN}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = json.itemSummaries || [];
          const sales = items.map(item => ({
            title: item.title || '',
            price: parseFloat(item.price?.value || 0),
            date: new Date().toISOString().split('T')[0],
            condition: item.condition || detectCondition(item.title),
            url: item.itemWebUrl || '#',
          })).filter(s => s.price > 0);
          resolve(sales);
        } catch(e) {
          reject(new Error(`Parse: ${data.substring(0,150)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.end();
  });
}

// Fallback demo data
function demo(query) {
  const base = Math.random() * 150 + 10;
  return Array.from({length:20}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - i*3);
    const v = (Math.random()-0.4)*0.25;
    const conds = ['Raw','Raw','Raw','PSA 10','PSA 9','BGS 9.5'];
    return {
      title: `${query} Card`,
      price: parseFloat((base*(1+v)).toFixed(2)),
      date: d.toISOString().split('T')[0],
      condition: conds[Math.floor(Math.random()*conds.length)],
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1`,
    };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    const sales = await fetchEbay(query);
    res.json(sales.length ? sales : demo(query));
  } catch(e) {
    console.error(e.message);
    res.json(demo(query));
  }
};
