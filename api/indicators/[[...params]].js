const { getDb, withDatabaseConfigError } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');
const { computeIndicator } = require('../_lib/compute');
const { ensureBundlePricing, ensureForkColumns, ensureEngagement } = require('../_lib/migrations');
const {
  bundlePricesFromRow,
  configFromRow,
  hasPaidPricing,
  marketCountFromRow,
  minBundlePrice,
  previewMarketsFromRow,
  publicIndicatorPayload,
} = require('../_lib/indicatorPrivacy');

module.exports = withDatabaseConfigError(async function handler(req, res) {
  const raw = req.query.params ?? req.query['[...params]'];
  const params = Array.isArray(raw) ? raw : raw ? [raw] : [];

  // GET/POST /api/indicators — index
  if (params.length === 0) return handleIndex(req, res);
  // GET /api/indicators/public
  if (params[0] === 'public') return handlePublic(req, res);
  // POST /api/indicators/migrate
  if (params[0] === 'migrate') return handleMigrate(req, res);
  // GET /api/indicators/:id/page — HTML page (also via ?action=page rewrite)
  if (params.length === 2 && params[1] === 'page') return handlePage(req, res, params[0]);
  // POST /api/indicators/:id/view
  if (params.length === 2 && params[1] === 'view') return handleView(req, res, params[0]);
  // GET/POST /api/indicators/:id/comments
  if (params.length === 2 && params[1] === 'comments') return handleComments(req, res, params[0]);
  // GET/PUT/DELETE /api/indicators/:id
  if (params.length === 1) {
    if (req.query.action === 'page') return handlePage(req, res, params[0]);
    return handleById(req, res, params[0]);
  }

  return res.status(404).json({ error: 'Not found' });
});

async function handleIndex(req, res) {
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const sql = getDb();
  await ensureBundlePricing();
  await ensureForkColumns();
  await ensureEngagement();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, sector, asset, markets, weights, fg_enabled, fg_weight,
             include_other, is_public, price_bundle_10, price_bundle_50, price_bundle_100, price_bundle_500,
             view_count, comment_count, published_at, forked_from, fork_count,
             created_at, updated_at
      FROM indicators WHERE user_id = ${auth.id} ORDER BY created_at DESC
    `;
    return res.json(rows.map(r => {
      const base = publicIndicatorPayload(r, { includeConfig: true });
      return {
        ...base,
        fgEnabled: r.fg_enabled, fgWeight: r.fg_weight, includeOther: r.include_other,
        isPublic: r.is_public,
        viewCount: r.view_count || 0, commentCount: r.comment_count || 0,
        publishedAt: r.published_at, forkedFrom: r.forked_from, forkCount: r.fork_count || 0,
        createdAt: r.created_at, updatedAt: r.updated_at, _fromServer: true,
      };
    }));
  }

  if (req.method === 'POST') {
    const { id, name, sector, asset, weights, markets, referenceAsset, fgEnabled, fgWeight, includeOther, isPublic, bundlePrices, forkedFrom } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    const weightsPayload = markets
      ? { markets, referenceAsset: referenceAsset || null }
      : { ...(weights || {}), referenceAsset: referenceAsset || weights?.referenceAsset || null };

    // Duplicate detection: normalize config and compare against user's existing indicators
    const userRows = await sql`SELECT id, weights, fg_enabled, fg_weight, sector, asset FROM indicators WHERE user_id = ${auth.id}`;
    const normalizeConfig = (m, fg, fgW, s, a) => {
      const mk = m?.markets || m || {};
      const sorted = Object.keys(mk)
        .filter(k => !['referenceAsset'].includes(k))
        .sort()
        .reduce((o, k) => { o[k] = mk[k]; return o; }, {});
      return JSON.stringify({
        markets: sorted,
        referenceAsset: m?.referenceAsset || null,
        fg: !!fg,
        fgW: fgW || 30,
        sector: s || 'crypto',
        asset: a || 'BTC',
      });
    };
    const newNorm = normalizeConfig(weightsPayload, fgEnabled, fgWeight, sector, asset);
    for (const row of userRows) {
      if (id && row.id === id) continue; // skip self on upsert
      const existNorm = normalizeConfig(row.weights, row.fg_enabled, row.fg_weight, row.sector, row.asset);
      if (existNorm === newNorm) {
        return res.status(409).json({ error: 'Duplicate indicator', existingId: row.id });
      }
    }

    const indicatorId = id || Math.random().toString(36).substr(2, 8);
    const bp = bundlePrices || {};
    if (forkedFrom) {
      const sourceRows = await sql`
        SELECT id, price_bundle_10, price_bundle_50, price_bundle_100, price_bundle_500
        FROM indicators
        WHERE id = ${forkedFrom}
      `;
      if (sourceRows.length === 0) return res.status(404).json({ error: 'Fork source not found' });
      if (hasPaidPricing(sourceRows[0])) {
        return res.status(403).json({ error: 'Paid indicators cannot be forked' });
      }
    }
    const pubAt = (isPublic !== false) ? new Date().toISOString() : null;
    await sql`
      INSERT INTO indicators (id, user_id, name, sector, asset, weights, fg_enabled, fg_weight, include_other, is_public,
                               price_bundle_10, price_bundle_50, price_bundle_100, price_bundle_500,
                               published_at, forked_from)
      VALUES (${indicatorId}, ${auth.id}, ${name}, ${sector || 'crypto'}, ${asset || 'BTC'},
              ${JSON.stringify(weightsPayload)}, ${fgEnabled || false}, ${fgWeight || 30},
              ${includeOther || false}, ${isPublic !== false},
              ${bp[10] || null}, ${bp[50] || null}, ${bp[100] || null}, ${bp[500] || null},
              ${pubAt}, ${forkedFrom || null})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, sector = EXCLUDED.sector, asset = EXCLUDED.asset,
        weights = EXCLUDED.weights, fg_enabled = EXCLUDED.fg_enabled, fg_weight = EXCLUDED.fg_weight,
        include_other = EXCLUDED.include_other, is_public = EXCLUDED.is_public,
        price_bundle_10 = EXCLUDED.price_bundle_10, price_bundle_50 = EXCLUDED.price_bundle_50,
        price_bundle_100 = EXCLUDED.price_bundle_100, price_bundle_500 = EXCLUDED.price_bundle_500,
        updated_at = now()
    `;

    // Increment parent fork_count
    if (forkedFrom) {
      await sql`UPDATE indicators SET fork_count = COALESCE(fork_count, 0) + 1 WHERE id = ${forkedFrom}`.catch(() => {});
    }

    return res.json({ id: indicatorId });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleById(req, res, id) {
  const sql = getDb();
  if (req.method === 'GET') {
    await ensureForkColumns();
    await ensureEngagement();
    const rows = await sql`
      SELECT i.*, u.display_name as creator_name, u.wallet_address as creator_wallet
      FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.id = ${id}
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    const auth = authenticate(req);
    if (!r.is_public && !(auth && auth.id === r.user_id)) return res.status(404).json({ error: 'Not found' });
    const isOwner = auth && auth.id === r.user_id;
    const paid = hasPaidPricing(r);
    const base = publicIndicatorPayload(r, { includeConfig: isOwner || !paid });
    return res.json({
      ...base,
      fgEnabled: r.fg_enabled, fgWeight: r.fg_weight, includeOther: r.include_other,
      isPublic: r.is_public,
      viewCount: r.view_count || 0, commentCount: r.comment_count || 0,
      creatorName: r.creator_name, creatorWallet: r.creator_wallet,
      publishedAt: r.published_at, forkedFrom: r.forked_from, forkCount: r.fork_count || 0,
      createdAt: r.created_at, _fromServer: true,
    });
  }

  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'PUT') {
    await ensureForkColumns();
    const existing = await sql`SELECT user_id, is_public, published_at FROM indicators WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });
    if (existing[0].user_id !== auth.id) return res.status(403).json({ error: 'Forbidden' });
    const { name, sector, asset, weights, markets, referenceAsset, fgEnabled, fgWeight, includeOther, isPublic, bundlePrices } = req.body || {};
    const weightsPayload = markets
      ? JSON.stringify({ markets, referenceAsset: referenceAsset || null })
      : (weights ? JSON.stringify({ ...weights, referenceAsset: referenceAsset || weights.referenceAsset || null }) : null);
    const bp = bundlePrices || {};
    // Set published_at when flipping from private to public for the first time
    const setPublishedAt = (isPublic === true && !existing[0].is_public && !existing[0].published_at);
    await sql`
      UPDATE indicators SET name = COALESCE(${name}, name), sector = COALESCE(${sector}, sector),
        asset = COALESCE(${asset}, asset), weights = COALESCE(${weightsPayload}, weights),
        fg_enabled = COALESCE(${fgEnabled}, fg_enabled), fg_weight = COALESCE(${fgWeight}, fg_weight),
        include_other = COALESCE(${includeOther}, include_other), is_public = COALESCE(${isPublic}, is_public),
        price_bundle_10 = ${bp[10] !== undefined ? bp[10] : null},
        price_bundle_50 = ${bp[50] !== undefined ? bp[50] : null},
        price_bundle_100 = ${bp[100] !== undefined ? bp[100] : null},
        price_bundle_500 = ${bp[500] !== undefined ? bp[500] : null},
        published_at = COALESCE(${setPublishedAt ? new Date().toISOString() : null}::timestamptz, published_at),
        updated_at = now()
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

  await ensureForkColumns();
  await ensureEngagement();
  try {
    let rows;
    if (sector) {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.is_public, i.latest_score, i.markets, i.weights, i.fg_enabled, i.fg_weight, i.price_bundle_10, i.price_bundle_50, i.price_bundle_100, i.price_bundle_500, i.view_count, i.comment_count, i.created_at, i.published_at, i.forked_from, i.fork_count, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true AND i.sector = ${sector} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    } else {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.is_public, i.latest_score, i.markets, i.weights, i.fg_enabled, i.fg_weight, i.price_bundle_10, i.price_bundle_50, i.price_bundle_100, i.price_bundle_500, i.view_count, i.comment_count, i.created_at, i.published_at, i.forked_from, i.fork_count, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    }
    const indicators = rows.map(r => {
      const paid = hasPaidPricing(r);
      const base = publicIndicatorPayload(r, { includeConfig: !paid });
      return {
        ...base,
        score: paid ? null : (r.latest_score != null ? parseFloat(r.latest_score) : null),
        label: paid ? 'Protected' : scoreLabel(r.latest_score),
        creator: r.creator_name || 'Anonymous',
        viewCount: r.view_count || 0, commentCount: r.comment_count || 0,
        fgEnabled: r.fg_enabled || false, fgWeight: r.fg_weight || 30,
        publishedAt: r.published_at, forkedFrom: r.forked_from, forkCount: r.fork_count || 0,
        createdAt: r.created_at,
      };
    });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json({ indicators, count: indicators.length, offset, limit });
  } catch (err) {
    console.error('Public indicators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPublicIndicator(sql, id) {
  const rows = await sql`SELECT id, is_public FROM indicators WHERE id = ${id}`;
  if (rows.length === 0 || !rows[0].is_public) return null;
  return rows[0];
}

async function handleView(req, res, id) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const sql = getDb();
  await ensureEngagement();
  const indicator = await getPublicIndicator(sql, id);
  if (!indicator) return res.status(404).json({ error: 'Not found' });
  const rows = await sql`
    UPDATE indicators
    SET view_count = COALESCE(view_count, 0) + 1
    WHERE id = ${id}
    RETURNING view_count
  `;
  return res.json({ viewCount: rows[0]?.view_count || 0 });
}

async function handleComments(req, res, id) {
  const sql = getDb();
  await ensureEngagement();
  const indicator = await getPublicIndicator(sql, id);
  if (!indicator) return res.status(404).json({ error: 'Not found' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT c.id, c.body, c.author_name, c.created_at, c.user_id, u.wallet_address AS user_wallet
      FROM indicator_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.indicator_id = ${id} AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 50
    `;
    return res.json({
      comments: rows.map(r => ({
        id: r.id,
        body: r.body,
        authorName: commentAuthorLabel(r),
        createdAt: r.created_at,
      })),
    });
  }

  if (req.method === 'POST') {
    const auth = authenticate(req);
    const body = String(req.body?.body || '').trim();
    const authorName = 'Guest';
    if (body.length < 2) return res.status(400).json({ error: 'Comment is too short' });
    if (body.length > 1000) return res.status(400).json({ error: 'Comment is too long' });
    const rate = await checkCommentRateLimit(sql, id, auth);
    if (!rate.allowed) {
      return res.status(429).json({ error: rate.error, retryAfter: rate.retryAfter });
    }
    const rows = await sql`
      INSERT INTO indicator_comments (indicator_id, user_id, author_name, body)
      VALUES (${id}, ${auth?.id || null}, ${auth ? null : authorName}, ${body})
      RETURNING id, body, author_name, created_at, user_id
    `;
    await sql`
      UPDATE indicators
      SET comment_count = (
        SELECT COUNT(*) FROM indicator_comments WHERE indicator_id = ${id} AND deleted_at IS NULL
      )
      WHERE id = ${id}
    `;
    const c = rows[0];
    let resolvedAuthorName = c.author_name || 'Guest';
    if (auth) {
      const userRows = await sql`SELECT id AS user_id, wallet_address AS user_wallet FROM users WHERE id = ${auth.id}`;
      resolvedAuthorName = commentAuthorLabel(userRows[0] || { user_id: auth.id, user_wallet: auth.wallet });
    }
    return res.status(201).json({
      comment: {
        id: c.id,
        body: c.body,
        authorName: resolvedAuthorName,
        createdAt: c.created_at,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
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
      const weightsPayload = ind.markets
        ? { markets: ind.markets, referenceAsset: ind.referenceAsset || null }
        : { ...(ind.weights || {}), referenceAsset: ind.referenceAsset || ind.weights?.referenceAsset || null };
      await sql`INSERT INTO indicators (id, user_id, name, sector, asset, weights, fg_enabled, fg_weight, include_other) VALUES (${ind.id}, ${auth.id}, ${ind.name}, ${ind.sector || 'crypto'}, ${ind.asset || 'BTC'}, ${JSON.stringify(weightsPayload)}, ${ind.fgEnabled || false}, ${ind.fgWeight || 30}, ${ind.includeOther || false}) ON CONFLICT (id) DO NOTHING`;
      imported++;
    } catch (e) { console.error('Migration failed for indicator:', ind.id, e.message); }
  }
  res.json({ imported, total: indicators.length });
}

async function handlePage(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const sql = getDb();
  await ensureForkColumns();
  await ensureEngagement();
  const rows = await sql`SELECT i.*, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.id = ${id} AND i.is_public = true`;

  if (rows.length === 0) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send('<html><body style="background:#030712;color:#9ca3af;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><h1>Indicator not found</h1></body></html>');
  }

  const indicator = rows[0];
  const isProtected = hasPaidPricing(indicator);
  await sql`UPDATE indicators SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ${id}`.catch(() => {});
  let result;
  if (isProtected) {
    const { referenceAsset } = configFromRow(indicator);
    result = {
      latestScore: null,
      breakdown: {},
      config: {
        asset: indicator.asset || 'BTC',
        referenceAsset,
        marketCount: marketCountFromRow(indicator),
        fgEnabled: false,
      },
      dates: [],
      scores: [],
      prices: [],
    };
  } else {
    try { result = await computeIndicator(indicator); } catch (e) {
      console.error('Compute error:', e);
      res.setHeader('Content-Type', 'text/html');
      return res.status(500).send('<html><body style="background:#030712;color:#9ca3af;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh"><h1>Error computing indicator</h1></body></html>');
    }
  }

  const { latestScore, breakdown, config, dates, scores, prices } = result;
  const label = isProtected ? 'Protected' : (latestScore != null ? scoreLabel(latestScore) : 'N/A');
  const scoreStr = latestScore != null ? latestScore.toFixed(1) : '--';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeName = esc(indicator.name);
  const safeCreator = esc(indicator.creator_name || 'Anonymous');
  const safeAsset = esc(config.asset);
  const bundlePrices = bundlePricesFromRow(indicator);
  const bp100 = bundlePrices[100];
  const minPrice = minBundlePrice(bundlePrices);
  const priceInfo = bp100 ? `${bp100} SOL / 100 calls` : (minPrice ? `From ${minPrice} SOL` : 'Free');
  const isMarketMode = !!config.markets;
  const visibleMarketCount = config.marketCount || marketCountFromRow(indicator);
  const previewMarketEntries = previewMarketsFromRow(indicator, 4);
  const previewEntries = previewMarketEntries.length
    ? previewMarketEntries.map((m, idx) => `<div class="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0"><div class="flex-1 min-w-0"><div class="text-sm text-gray-300 truncate">${esc(m.id)}</div><div class="mt-1 text-[11px] text-gray-500">sample market ${idx + 1}</div></div><span class="text-[11px] text-gray-600 blur-[3px] select-none">weight ${idx % 2 ? '42' : '78'}%</span></div>`)
    : [`<div class="text-sm text-gray-400">Market preview unavailable for this indicator.</div>`];
  const weightEntries = isProtected
    ? [
        `<div class="space-y-1">${previewEntries.join('')}</div>`,
        `<div class="mt-3 text-sm flex justify-between"><span class="text-gray-400">Hidden inputs</span><span class="text-gray-200">${Math.max(0, visibleMarketCount - previewMarketEntries.length)} markets</span></div>`,
      ]
    : (isMarketMode
      ? [`<div class="text-sm text-gray-400">${visibleMarketCount} markets selected</div>`]
      : Object.entries(config.weights || {}).filter(([k, v]) => v > 0 && k !== 'other').map(([k, v]) => `<div class="flex justify-between"><span class="text-gray-400 capitalize">${k.replace('_', ' ')}</span><span class="text-gray-200">${v}%</span></div>`));
  const breakdownEntries = Object.keys(breakdown).length > 0
    ? Object.entries(breakdown).map(([k, v]) => `<div class="flex justify-between"><span class="text-gray-400 capitalize">${k.replace('_', ' ')}</span><span class="text-gray-200">${v.toFixed(1)}</span></div>`)
    : [`<div class="text-sm text-gray-400">Per-market mode</div>`];
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
<nav class="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800/50"><div class="max-w-4xl mx-auto px-4 flex items-center justify-between h-14"><a href="/" class="text-sm font-semibold text-gray-300">PMSI</a><div class="flex items-center gap-2"><button onclick="copyLink()" id="copy-link-btn" class="px-3 py-1.5 text-sm text-gray-400 border border-gray-700 rounded-lg hover:text-gray-200 hover:border-gray-500 transition-colors">Copy Link</button>${isProtected ? '<span class="px-3 py-1.5 text-sm text-amber-200 border border-amber-500/30 rounded-lg bg-amber-500/10">Protected</span>' : `<a href="/#builder?fork=${id}" class="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Fork in Builder</a>`}</div></div></nav>
<div class="max-w-4xl mx-auto px-4 py-8 space-y-6"><div class="flex items-center justify-between"><div><h1 class="text-2xl font-light text-gray-100">${safeName}</h1><p class="text-sm text-gray-500 mt-1">by ${safeCreator} &middot; ${safeAsset}${indicator.published_at ? ' &middot; Published ' + new Date(indicator.published_at).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) : ''}${(indicator.fork_count || 0) > 0 ? ' &middot; <span class="text-blue-400">' + indicator.fork_count + ' fork' + (indicator.fork_count !== 1 ? 's' : '') + '</span>' : ''}</p></div><div class="text-right"><div class="text-3xl font-bold text-gray-100">${scoreStr}</div><div class="text-sm text-gray-400">${label}</div></div></div>
<div class="bg-gray-900/50 rounded-2xl p-6 border border-gray-800/50" style="height:350px"><canvas id="chart"></canvas></div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">${isProtected ? 'Recipe' : 'Weights'}</h3><div class="space-y-2 text-sm">${weightEntries.join('')}</div>${!isProtected && config.fgEnabled ? `<div class="mt-2 text-sm flex justify-between"><span class="text-gray-400">Fear & Greed</span><span class="text-gray-200">${config.fgWeight}%</span></div>` : ''}</div><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">Category Scores</h3><div class="space-y-2 text-sm">${breakdownEntries.join('')}</div></div><div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50"><h3 class="text-xs text-gray-500 uppercase mb-3">API</h3><div class="text-sm space-y-2"><div class="text-gray-400">Endpoint</div><code class="text-xs text-blue-400 bg-gray-800 px-2 py-1 rounded block break-all">/api/v1/indicators/${id}</code><div class="text-gray-400 mt-2">Pricing</div><div class="text-gray-200">${priceInfo}</div></div></div></div></div>
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

function shortWallet(wallet) {
  if (!wallet) return null;
  const w = String(wallet);
  if (w.length <= 12) return w;
  return `${w.slice(0, 4)}..${w.slice(-4)}`;
}

function commentAuthorLabel(row = {}) {
  return shortWallet(row.user_wallet) || (row.user_id ? 'Account' : (row.author_name || 'Guest'));
}

async function checkCommentRateLimit(sql, indicatorId, auth) {
  if (auth?.id) {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM indicator_comments
      WHERE indicator_id = ${indicatorId}
        AND user_id = ${auth.id}
        AND created_at > now() - interval '1 minute'
    `;
    if ((rows[0]?.count || 0) >= 3) {
      return { allowed: false, error: 'Slow down before posting another comment', retryAfter: 60 };
    }
    return { allowed: true };
  }

  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS minute_count,
      COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour_count
    FROM indicator_comments
    WHERE indicator_id = ${indicatorId}
      AND user_id IS NULL
      AND deleted_at IS NULL
  `;
  if ((rows[0]?.minute_count || 0) >= 5 || (rows[0]?.hour_count || 0) >= 30) {
    return { allowed: false, error: 'Guest comments are temporarily rate limited', retryAfter: 60 };
  }
  return { allowed: true };
}
