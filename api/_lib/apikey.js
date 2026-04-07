const crypto = require('crypto');
const { getDb } = require('./db');
const { getTokenBalance, getTokenConfig } = require('./solana');
const { ensureTokenColumns } = require('./migrations');

/**
 * Validate API key from X-API-Key header.
 * Credit resolution: DB credits first, then token-based daily allowance.
 * Returns { key, sql, creditsRemaining, creditSource } on success, or sends error and returns null.
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

  await ensureTokenColumns();

  const keys = await sql`
    SELECT k.id, k.user_id, k.credits_remaining, k.rate_limit_per_min,
           u.wallet_address, u.token_calls_today, u.token_calls_date
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = ${keyHash} AND k.revoked_at IS NULL
  `;

  if (keys.length === 0) {
    res.status(401).json({ error: 'Invalid API key' });
    return null;
  }

  const key = keys[0];

  // Determine credit source: DB first, then token holdings
  let creditSource = 'db';
  let tokenAllowance = 0;
  let tokenUsedToday = 0;

  if (key.credits_remaining <= 0) {
    // Try token-based credits
    const tokenConfig = getTokenConfig();
    if (tokenConfig.enabled && key.wallet_address) {
      const balance = await getTokenBalance(key.wallet_address);
      tokenAllowance = Math.floor(balance) * tokenConfig.creditsPerToken;

      // Check daily usage — reset if new day
      const today = new Date().toISOString().slice(0, 10);
      if (key.token_calls_date === today) {
        tokenUsedToday = key.token_calls_today || 0;
      } else {
        tokenUsedToday = 0;
      }

      if (tokenAllowance > 0 && tokenUsedToday < tokenAllowance) {
        creditSource = 'token';
      } else {
        res.status(402).json({
          error: 'Credits exhausted',
          credits: 0,
          tokenBalance: balance,
          tokenAllowance,
          tokenUsedToday,
          hint: tokenAllowance > 0
            ? 'Daily token allowance used. Resets at midnight UTC.'
            : 'Hold PMSI tokens or purchase credits for API access.',
        });
        return null;
      }
    } else {
      res.status(402).json({
        error: 'Credits exhausted',
        credits: 0,
        hint: 'Hold PMSI tokens in your wallet or purchase credits.',
      });
      return null;
    }
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
      creditSource,
      async logUsage(indicatorId) {
        const responseMs = Date.now() - start;
        if (creditSource === 'db') {
          await sql`UPDATE api_keys SET credits_remaining = credits_remaining - 1, last_used_at = now() WHERE id = ${key.id}`;
        } else {
          // Token credits: increment daily counter
          const today = new Date().toISOString().slice(0, 10);
          await sql`
            UPDATE users SET
              token_calls_today = CASE WHEN token_calls_date = ${today}::date THEN token_calls_today + 1 ELSE 1 END,
              token_calls_date = ${today}::date
            WHERE id = ${key.user_id}
          `;
          await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${key.id}`;
        }
        await sql`
          INSERT INTO api_usage (api_key_id, indicator_id, endpoint, response_ms, credit_source)
          VALUES (${key.id}, ${indicatorId || null}, ${endpoint}, ${responseMs}, ${creditSource})
        `;
      },
      creditsRemaining: creditSource === 'db'
        ? key.credits_remaining - 1
        : tokenAllowance - tokenUsedToday - 1,
    };
  }

  return {
    key,
    sql,
    creditSource,
    creditsRemaining: creditSource === 'db'
      ? key.credits_remaining
      : tokenAllowance - tokenUsedToday,
  };
}

module.exports = { validateApiKey };
