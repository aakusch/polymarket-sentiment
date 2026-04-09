const { validateApiKey } = require('../../_lib/apikey');
const { computeIndicator } = require('../../_lib/compute');
const { getDb } = require('../../_lib/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = req.query.params ?? req.query["[...params]"]; const params = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(p => p !== '__root');

  // GET /api/v2/indicators — list public indicators
  if (params.length === 0) return handleList(req, res);
  // GET /api/v2/indicators/:id/latest
  if (params.length === 2 && params[1] === 'latest') return handleLatest(req, res, params[0]);
  // GET /api/v2/indicators/:id/timeseries
  if (params.length === 2 && params[1] === 'timeseries') return handleTimeseries(req, res, params[0]);

  return res.status(404).json({ error: 'Not found' });
};

async function handleList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateApiKey(req, res, { deductCredit: false, endpoint: '/v2/indicators' });
  if (!auth) return;

  let { sort = 'score', sector, asset, limit: rawLimit, offset: rawOffset } = req.query;
  const limit = Math.min(Math.max(parseInt(rawLimit) || 20, 1), 100);
  const offset = Math.max(parseInt(rawOffset) || 0, 0);
  const sql = auth.sql;

  const validSorts = ['score', 'newest', 'name'];
  if (!validSorts.includes(sort)) sort = 'score';

  try {
    const orderBy = sort === 'newest' ? sql`i.created_at DESC` : sort === 'name' ? sql`i.name ASC` : sql`i.latest_score DESC NULLS LAST`;
    let rows;
    if (sector && asset) {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.latest_score, i.fg_enabled, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true AND i.sector = ${sector} AND i.asset = ${asset} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    } else if (sector) {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.latest_score, i.fg_enabled, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true AND i.sector = ${sector} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    } else if (asset) {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.latest_score, i.fg_enabled, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true AND i.asset = ${asset} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    } else {
      rows = await sql`SELECT i.id, i.name, i.sector, i.asset, i.latest_score, i.fg_enabled, i.created_at, u.display_name as creator_name FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.is_public = true ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    }

    const indicators = rows.map(r => ({
      id: r.id, name: r.name, sector: r.sector || 'crypto', asset: r.asset || 'BTC',
      score: r.latest_score != null ? parseFloat(r.latest_score) : null,
      label: scoreLabel(r.latest_score), creator: r.creator_name || 'Anonymous',
      fgEnabled: r.fg_enabled || false, createdAt: r.created_at,
      endpoints: { latest: `/api/v2/indicators/${r.id}/latest`, timeseries: `/api/v2/indicators/${r.id}/timeseries` },
    }));
    res.json({ indicators, pagination: { limit, offset, count: indicators.length }, credits_remaining: auth.creditsRemaining });
  } catch (err) {
    console.error('v2 indicators list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLatest(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateApiKey(req, res, { endpoint: '/v2/indicators/latest' });
  if (!auth) return;

  try {
    const sql = auth.sql;
    const rows = await sql`
      SELECT i.id, i.name, i.sector, i.asset, i.latest_score, i.fg_enabled, i.fg_weight, u.display_name as creator_name
      FROM indicators i JOIN users u ON i.user_id = u.id WHERE i.id = ${id} AND i.is_public = true
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Indicator not found' });

    const ind = rows[0];
    const score = ind.latest_score != null ? parseFloat(ind.latest_score) : null;
    await auth.logUsage(id);

    res.json({
      id: ind.id, name: ind.name, asset: ind.asset || 'BTC', sector: ind.sector || 'crypto',
      score, label: scoreLabel(score), fgEnabled: ind.fg_enabled || false,
      creator: ind.creator_name || 'Anonymous', credits_remaining: auth.creditsRemaining,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('v2 latest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleTimeseries(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateApiKey(req, res, { endpoint: '/v2/indicators/timeseries' });
  if (!auth) return;

  const { start, end } = req.query;

  try {
    const sql = auth.sql;
    const rows = await sql`SELECT * FROM indicators WHERE id = ${id} AND is_public = true`;
    if (rows.length === 0) return res.status(404).json({ error: 'Indicator not found' });

    const indicator = rows[0];
    const result = await computeIndicator(indicator);
    await auth.logUsage(id);

    let { dates, scores, prices, fgValues } = result;
    if (start || end) {
      const filtered = { dates: [], scores: [], prices: [], fgValues: [] };
      for (let i = 0; i < dates.length; i++) {
        if (start && dates[i] < start) continue;
        if (end && dates[i] > end) continue;
        filtered.dates.push(dates[i]); filtered.scores.push(scores[i]);
        filtered.prices.push(prices[i]); filtered.fgValues.push(fgValues[i]);
      }
      dates = filtered.dates; scores = filtered.scores; prices = filtered.prices; fgValues = filtered.fgValues;
    }

    res.json({
      id: indicator.id, name: indicator.name, asset: result.config.asset,
      timeseries: { dates, scores, prices, fgValues, points: dates.length },
      latestScore: result.latestScore,
      predictive: result.predictive || null,
      credits_remaining: auth.creditsRemaining,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('v2 timeseries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
