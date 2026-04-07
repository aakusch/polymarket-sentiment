const { getDb } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');
const { computeIndicator } = require('../_lib/compute');

module.exports = async function handler(req, res) {
  const params = req.query.params || [];

  // GET/POST /api/indicators — index
  if (params.length === 0) return handleIndex(req, res);
  // GET /api/indicators/public
  if (params[0] === 'public') return handlePublic(req, res);
  // POST /api/indicators/migrate
  if (params[0] === 'migrate') return handleMigrate(req, res);
  // GET /api/indicators/:id/page — HTML page
  if (params.length === 2 && params[1] === 'page') return handlePage(req, res, params[0]);
  // GET/PUT/DELETE /api/indicators/:id
  if (params.length === 1) return handleById(req, res, params[0]);

  return res.status(404).json({ error: 'Not found' });
};

async function handleIndex(req, res) {
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, sector, asset, weights, fg_enabled, fg_weight,
             include_other, is_public, price_per_100, price_token, created_at, updated_at
      FROM indicators WHERE user_id = ${auth.id} ORDER BY created_at DESC
    `;
    return res.json(rows.map(r => {
      const w = r.weights || {};
      return {
        id: r.id, name: r.name, sector: r.sector, asset: r.asset,
        ...(w.markets ? { markets: w.markets } : { weights: w }),
        fgEnabled: r.fg_enabled, fgWeight: r.fg_weight, includeOther: r.include_other,
        isPublic: r.is_public, pricePer100: r.price_per_100 ? parseFloat(r.price_per_100) : null,
        priceToken: r.price_token, createdAt: r.created_at, updatedAt: r.updated_at, _fromServer: true,
      };
    }));
  }

  if (req.method === 'POST') {
    const { id, name, sector, asset, weights, markets, fgEnabled, fgWeight, includeOther, isPublic, pricePer100 } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    const weightsPayload = markets ? { markets } : (weights || {});
    const indicatorId = id || Math.random().toString(36).substr(2, 8);
    await sql`
      INSERT INTO indicators (id, user_id, name, sector, asset, weights, fg_enabled, fg_weight, include_other, is_public, price_per_100)
      VALUES (${indicatorId}, ${auth.id}, ${name}, ${sector || 'crypto'}, ${asset || 'BTC'},
              ${JSON.stringify(weightsPayload)}, ${fgEnabled || false}, ${fgWeight || 30},
              ${includeOther || false}, ${isPublic !== false}, ${pricePer100 || null})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, sector = EXCLUDED.sector, asset = EXCLUDED.asset,
        weights = EXCLUDED.weights, fg_enabled = EXCLUDED.fg_enabled, fg_weight = EXCLUDED.fg_weight,
        include_other = EXCLUDED.include_other, is_public = EXCLUDED.is_public,
        price_per_100 = EXCLUDED.price_per_100, updated_at = now()
    `;
    return res.json({ id: indicatorId });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleById(req, res, id) {
  const sql = getDb();
  if (req.method === 'GET') {
    const rows = await sql`
      SELECT i.*, u.display_name as creator_name, u.wallet_address as creator_wallet
      FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.id = ${id}
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    const auth = authenticate(req);
    if (!r.is_public && !(auth && auth.id === r.user_id)) return res.status(404).json({ error: 'Not found' });
    const w = r.weights || {};
    return res.json({
      id: r.id, name: r.name, sector: r.sector, asset: r.asset,
      ...(w.markets ? { markets: w.markets } : { weights: w }),
      fgEnabled: r.fg_enabled, fgWeight: r.fg_weight, includeOther: r.include_other,
      isPublic: r.is_public, pricePer100: r.price_per_100 ? parseFloat(r.price_per_100) : null,
      priceToken: r.price_token, creatorName: r.creator_name, creatorWallet: r.creator_wallet,
      createdAt: r.created_at, _fromServer: true,
    });
  }

  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'PUT') {
    const existing = await sql`SELECT user_id FROM indicators WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    if (existing[0].user_id !== auth.id) return res.status(403).json({ error: 'Forbidden' });
    const { name, sector, asset, weights, markets, fgEnabled, fgWeight, includeOther, isPublic, pricePer100 } = req.body || {};
    const weightsPayload = markets ? JSON.stringify({ markets }) : (weights ? JSON.stringify(weights) : null);
    await sql`
      UPDATE indicators SET name = COALESCE(${name}, name), sector = COALESCE(${sector}, sector),
        asset = COALESCE(${asset}, asset), weights = COALESCE(${weightsPayload}, weights),
        fg_enabled = COALESCE(${fgEnabled}, fg_enabled), fg_weight = COALESCE(${fgWeight}, fg_weight),
        include_other = COALESCE(${includeOther}, include_other), is_public = COALESCE(${isPublic}, is_public),
        price_per_100 = ${pricePer100 !== undefined ? pricePer100 : null}, updated_at = now()
      WHERE id = ${id}
    `;
    return res.json({ id });
  }

  if (req.method === 'DELETE') {
    const existing = await sql`SELECT user_id FROM indicators WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    if (existing[0].user_id !== auth.id) return res.status(403).json({ error: 'Forbidden' });
    await sql`DELETE FROM indicators WHERE id = ${id}`;
    return res.json({ deleted: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handlePublic(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sql = getDb();
  const { sort = 'score', sector, limit: rawLimit, offset: rawOffset } = req.query;
  const limit = Math.min(Math.max(parseInt(rawLimit) || 50, 1), 100);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);
  const validSorts = ['score', 'newest', 'name'];
  const sortKey = validSorts.includes(sort) ? sort : 'score';
  const orderBy = sortKey === 'newest' ? sql`i.created_at DESC` : sortKey === 'name' ? sql`i.name ASC` : sql`i.latest_score DESC NULLS LAST`;

  try {
    let rows;
    if (sector) {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.is_public, i.latest_score, i.markets, i.weights, i.fg_enabled, i.fg_weight, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true AND i.sector = ${sector} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    } else {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.is_public, i.latest_score, i.markets, i.weights, i.fg_enabled, i.fg_weight, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    }
    const indicators = rows.map(r => {
      const markets = r.markets || r.weights?.markets || {};
      return { id: r.id, name: r.name, sector: r.sector || 'crypto', asset: r.asset || 'BTC', score: r.latest_score != null ? parseFloat(r.latest_score) : null, label: scoreLabel(r.latest_score), creator: r.creator_name || 'Anonymous', marketCount: typeof markets === 'object' ? Object.keys(markets).length : 0, fgEnabled: r.fg_enabled || false, createdAt: r.created_at };
    });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json({ indicators, count: indicators.length, offset, limit });
  } catch (err) {
    console.error('Public indicators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleMigrate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const { indicators } = req.body || {};
  if (!Array.isArray(indicators) || indicators.length === 0) return res.status(400).json({ error: 'No indicators to migrate' });

  const sql = getDb();
  let imported = 0;
  for (const ind of indicators) {
    if (!ind.name || !ind.id) continue;
    try {
      await sql`INSERT INTO indicators (id, user_id, name, sector, asset, weights, fg_enabled, fg_weight, include_other) VALUES (${ind.id}, ${auth.id}, ${ind.name}, ${ind.sector || 'crypto'}, ${ind.asset || 'BTC'}, ${JSON.stringify(ind.weights || {})}, ${ind.fgEnabled || false}, ${ind.fgWeight || 30}, ${ind.includeOther || false}) ON CONFLICT (id) DO NOTHING`;
      imported++;
    } catch (e) { console.error('Migration failed for indicator:', ind.id, e.message); }
  }
  res.json({ imported, total: indicators.length });
}

async function handlePage(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sql = getDb();
  const rows = await sql`SELECT i.*, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.id = ${id} AND i.is_public = true`;

  if (rows.length === 0) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send('<html><body style="background:#030712;color:#9ca3af;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><h1>Indicator not found</h1></body></html>');
  }

  const indicator = rows[0];
  let result;
  try { result = await computeIndicator(indicator); } catch (e) {
    console.error('Compute error:', e);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send('<html><body style="background:#030712;color:#9ca3af;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><h1>Error computing indicator</h1></body></html>');
  }

  const { latestScore, breakdown, config, dates, scores, prices } = result;
  const label = latestScore != null ? scoreLabel(latestScore) : 'N/A';
  const scoreStr = latestScore != null ? latestScore.toFixed(1) : '--';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeName = esc(indicator.name);
  const safeCreator = esc(indicator.creator_name || 'Anonymous');
  const safeAsset = esc(config.asset);
  const priceInfo = indicator.price_per_100 ? `${parseFloat(indicator.price_per_100)} ${indicator.price_token || 'SOL'} per 100 calls` : 'Free';
  const weightEntries = Object.entries(config.weights).filter(([k, v]) => v > 0 && k !== 'other').map(([k, v]) => `<div class="flex justify-between"><span class="text-gray-400 capitalize">${k.replace('_', ' ')}</span><span class="text-gray-200">${v}%</span></div>`);
  const breakdownEntries = Object.entries(breakdown).map(([k, v]) => `<div class="flex justify-between"><span class="text-gray-400 capitalize">${k.replace('_', ' ')}</span><span class="text-gray-200">${v.toFixed(1)}</span></div>`);
  const maxPts = 200, step = Math.max(1, Math.floor(dates.length / maxPts));
  const chartDates = [], chartScores = [], chartPrices = [];
  for (let i = 0; i < dates.length; i += step) { chartDates.push(dates[i]); chartScores.push(scores[i]); chartPrices.push(prices[i]); }

  const html = `<!DOCTYPE html>
<html lang="en" class="bg-gray-950"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeName} | PMSI</title>
<meta property="og:title" content="${safeName}"><meta property="og:description" content="${safeName}: ${scoreStr}/100 (${label}) — ${safeAsset} sentiment"><meta property="og:image" content="/api/og/${id}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeName}"><meta name="twitter:image" content="/api/og/${id}">
<script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script></head>
<body class="bg-gray-950 text-gray-200 min-h-screen">
<nav class="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800/50"><div class="max-w-4xl mx-auto px-4 flex items-center justify-between h-14"><a href="/" class="text-sm font-semibold text-gray-300">PMSI</a><div class="flex items-center gap-2"><button onclick="copyLink()" id="copy-link-btn" class="px-3 py-1.5 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-gray-200 hover:border-gray-500 transition-colors">Copy Link</button><a href="/#builder?fork=${id}" class="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Fork in Builder</a></div></div></nav>
<div class="max-w-4xl mx-auto px-4 py-8 space-y-6"><div class="flex items-center justify-between"><div><h1 class="text-2xl font-light text-gray-100">${safeName}</h1><p class="text-sm text-gray-500 mt-1">by ${safeCreator} &middot; ${safeAsset}</p></div><div class="text-right"><div class="text-3xl font-bold text-gray-100">${scoreStr}</div><div class="text-sm text-gray-400">${label}</div></div></div>
<div class="bg-gray-900/50 rounded-2xl p-6 border border-gray-800/50" style="height:350px"><canvas id="chart"></canvas></div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">Weights</h3><div class="space-y-2 text-sm">${weightEntries.join('')}</div>${config.fgEnabled ? `<div class="mt-2 text-sm flex justify-between"><span class="text-gray-400">Fear & Greed</span><span class="text-gray-200">${config.fgWeight}%</span></div>` : ''}</div><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">Category Scores</h3><div class="space-y-2 text-sm">${breakdownEntries.join('')}</div></div><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">API</h3><div class="text-sm space-y-2"><div class="text-gray-400">Endpoint</div><code class="text-xs text-blue-400 bg-gray-800 px-2 py-1 rounded block break-all">/api/v1/indicators/${id}</code><div class="text-gray-400 mt-2">Pricing</div><div class="text-gray-200">${priceInfo}</div></div></div></div></div>
<script>const dates=${JSON.stringify(chartDates)};const scores=${JSON.stringify(chartScores)};const prices=${JSON.stringify(chartPrices)};const labels=dates.map(d=>new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}));const ctx=document.getElementById('chart').getContext('2d');new Chart(ctx,{type:'line',data:{labels,datasets:[{label:${JSON.stringify(indicator.name)},data:scores,borderColor:'#60a5fa',backgroundColor:'rgba(96,165,250,0.08)',borderWidth:2,fill:true,tension:0.3,pointRadius:0,yAxisID:'y'},{label:${JSON.stringify(config.asset+' Price')},data:prices,borderColor:'#9ca3af',borderWidth:1.5,fill:false,tension:0.3,pointRadius:0,yAxisID:'y2'}]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{color:'#9ca3af',usePointStyle:true,pointStyle:'line'}}},scales:{y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#6b7280'},title:{display:true,text:'Score',color:'#6b7280'}},y2:{position:'right',grid:{display:false},ticks:{color:'#9ca3af',callback:v=>'$'+(v/1000).toFixed(0)+'K'},title:{display:true,text:'Price',color:'#9ca3af'}},x:{grid:{display:false},ticks:{color:'#6b7280',maxRotation:0,maxTicksLimit:10}}}}});</script>
<script>function copyLink(){navigator.clipboard.writeText(window.location.href).then(()=>{const btn=document.getElementById('copy-link-btn');btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy Link',2000)})}</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

function scoreLabel(n) {
  if (n == null) return null;
  n = parseFloat(n);
  if (n < 20) return 'Strongly Bearish';
  if (n < 40) return 'Bearish';
  if (n < 60) return 'Neutral';
  if (n < 80) return 'Bullish';
  return 'Strongly Bullish';
}
