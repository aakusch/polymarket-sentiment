const crypto = require('crypto');
const { getDb } = require('./db');
const { ensureBundlePricing } = require('./migrations');

/**
 * Validate API key from X-API-Key header.
 * Credit resolution: DB credits only. Purchase SOL bundles for more.
 * Returns { key, sql, creditsRemaining } on success, or sends error and returns null.
 */
async function validateApiKey(req, res, options = {}) {
  const { deductCredit = true, endpoint = req.url } = options;

  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    res.status(401).json({ error: 'Missing X-API-Key header' });
    return null;
  }

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const sql = getDb();

  await ensureBundlePricing();

  const keys = await sql`
    SELECT id, user_id, credits_remaining, rate_limit_per_min
    FROM api_keys
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
  `;

  if (keys.length === 0) {
    res.status(401).json({ error: 'Invalid API key' });
    return null;
  }

  const key = keys[0];

  if (key.credits_remaining <= 0) {
    res.status(402).json({
      error: 'Credits exhausted',
      credits: 0,
      hint: 'Purchase a SOL credit bundle at /api/credits/bundles',
    });
    return null;
  }

  // Check rate limit
  const usageCount = await sql`
    SELECT COUNT(*) as cnt FROM api_usage
    WHERE api_key_id = ${key.id} AND called_at > now() - interval '1 minute'
  `;

  if (parseInt(usageCount[0].cnt) >= key.rate_limit_per_min) {
    res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 60 });
    return null;
  }

  if (deductCredit) {
    const start = Date.now();
    return {
      key,
      sql,
      async logUsage(indicatorId) {
        const responseMs = Date.now() - start;
        await sql`UPDATE api_keys SET credits_remaining = credits_remaining - 1, last_used_at = now() WHERE id = ${key.id}`;
        await sql`
          INSERT INTO api_usage (api_key_id, indicator_id, endpoint, response_ms)
          VALUES (${key.id}, ${indicatorId || null}, ${endpoint}, ${responseMs})
        `;
      },
      creditsRemaining: key.credits_remaining - 1,
    };
  }

  return {
    key,
    sql,
    creditsRemaining: key.credits_remaining,
  };
}

module.exports = { validateApiKey };
