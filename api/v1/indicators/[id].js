const crypto = require('crypto');
const { getDb, withDatabaseConfigError } = require('../../_lib/db');
const { computeIndicator } = require('../../_lib/compute');
const { hasPaidPricing, paidApiConfigSummary } = require('../../_lib/indicatorPrivacy');

module.exports = withDatabaseConfigError(async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const sql = getDb();

  // Look up key
  const keys = await sql`
    SELECT id, user_id, credits_remaining, rate_limit_per_min
    FROM api_keys
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
  `;

  if (keys.length === 0) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const key = keys[0];

  // Check credits
  if (key.credits_remaining <= 0) {
    return res.status(402).json({ error: 'Credits exhausted', credits: 0 });
  }

  // Check rate limit
  const usageCount = await sql`
    SELECT COUNT(*) as cnt FROM api_usage
    WHERE api_key_id = ${key.id} AND called_at > now() - interval '1 minute'
  `;

  if (parseInt(usageCount[0].cnt) >= key.rate_limit_per_min) {
    return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 60 });
  }

  // Fetch indicator
  const { id } = req.query;
  const indicators = await sql`
    SELECT * FROM indicators WHERE id = ${id} AND is_public = true
  `;

  if (indicators.length === 0) {
    return res.status(404).json({ error: 'Indicator not found' });
  }

  const indicator = indicators[0];
  const start = Date.now();

  // Compute
  const result = await computeIndicator(indicator);
  const responseMs = Date.now() - start;

  // Decrement credits and log usage
  await sql`UPDATE api_keys SET credits_remaining = credits_remaining - 1, last_used_at = now() WHERE id = ${key.id}`;
  await sql`
    INSERT INTO api_usage (api_key_id, indicator_id, endpoint, response_ms)
    VALUES (${key.id}, ${id}, ${'/v1/indicators/' + id}, ${responseMs})
  `;

  res.json({
    id: indicator.id,
    name: indicator.name,
    asset: result.config.asset,
    score: result.latestScore,
    label: result.latestScore != null ? (result.latestScore >= 80 ? 'Strongly Bullish' : result.latestScore >= 60 ? 'Bullish' : result.latestScore >= 40 ? 'Neutral' : result.latestScore >= 20 ? 'Bearish' : 'Strongly Bearish') : null,
    predictive: result.predictive || null,
    breakdown: result.breakdown,
    config: hasPaidPricing(indicator) ? paidApiConfigSummary(indicator, result) : result.config,
    timeseries: {
      dates: result.dates,
      scores: result.scores,
    },
    credits_remaining: key.credits_remaining - 1,
    computed_at: new Date().toISOString(),
  });
});
