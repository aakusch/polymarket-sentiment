const { getDb } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');
const { verifyTransaction, getTokenBalance, getTokenConfig } = require('../_lib/solana');

const PLATFORM_WALLET = process.env.PLATFORM_WALLET;

module.exports = async function handler(req, res) {
  const { action } = req.query;

  switch (action) {
    case 'balance': return handleBalance(req, res);
    case 'purchase': return handlePurchase(req, res);
    case 'verify': return handleVerify(req, res);
    case 'token-info': return handleTokenInfo(req, res);
    default: return res.status(404).json({ error: 'Not found' });
  }
};

async function handleTokenInfo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const config = getTokenConfig();
  res.setHeader('Cache-Control', 's-maxage=60');
  return res.json({
    ...config,
    description: 'Hold PMSI tokens to receive daily API credit allowance.',
    pricing: `1 PMSI token = ${config.creditsPerToken} API calls/day`,
    tiers: [
      { name: 'Starter', tokens: 1, dailyCalls: config.creditsPerToken },
      { name: 'Builder', tokens: 10, dailyCalls: config.creditsPerToken * 10 },
      { name: 'Pro', tokens: 100, dailyCalls: config.creditsPerToken * 100 },
      { name: 'Enterprise', tokens: 1000, dailyCalls: config.creditsPerToken * 1000 },
    ],
  });
}

async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  const rows = await sql`
    SELECT COALESCE(SUM(credits_remaining), 0) as total
    FROM api_keys WHERE user_id = ${auth.id} AND revoked_at IS NULL
  `;
  const dbCredits = parseInt(rows[0].total);

  const tokenConfig = getTokenConfig();
  let tokenBalance = 0, tokenDailyAllowance = 0, tokenCallsUsedToday = 0;

  if (tokenConfig.enabled && auth.wallet) {
    tokenBalance = await getTokenBalance(auth.wallet);
    tokenDailyAllowance = Math.floor(tokenBalance) * tokenConfig.creditsPerToken;
    const today = new Date().toISOString().slice(0, 10);
    const usage = await sql`SELECT token_calls_today, token_calls_date FROM users WHERE id = ${auth.id}`;
    if (usage.length > 0 && usage[0].token_calls_date === today) {
      tokenCallsUsedToday = usage[0].token_calls_today || 0;
    }
  }

  const tokenCreditsRemaining = Math.max(0, tokenDailyAllowance - tokenCallsUsedToday);
  return res.json({ dbCredits, tokenBalance, tokenDailyAllowance, tokenCallsUsedToday, tokenCreditsRemaining, totalAvailable: dbCredits + tokenCreditsRemaining, token: tokenConfig });
}

async function handlePurchase(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const { indicatorId, credits, apiKeyId } = req.body || {};
  if (!indicatorId || !credits || credits < 100) return res.status(400).json({ error: 'indicatorId and credits (min 100) required' });

  const sql = getDb();
  const indicators = await sql`SELECT id, price_per_100, price_token, user_id FROM indicators WHERE id = ${indicatorId}`;
  if (indicators.length === 0) return res.status(404).json({ error: 'Indicator not found' });

  const indicator = indicators[0];
  const pricePer100 = indicator.price_per_100 ? parseFloat(indicator.price_per_100) : 0;

  if (pricePer100 === 0) {
    if (apiKeyId) await sql`UPDATE api_keys SET credits_remaining = credits_remaining + ${credits} WHERE id = ${apiKeyId} AND user_id = ${auth.id}`;
    return res.json({ free: true, credits });
  }

  const amount = (pricePer100 * credits) / 100;
  const creators = await sql`SELECT wallet_address FROM users WHERE id = ${indicator.user_id}`;
  const creatorWallet = creators[0]?.wallet_address || PLATFORM_WALLET;

  const payments = await sql`
    INSERT INTO payments (buyer_id, indicator_id, tx_signature, amount, token, credits_purchased,
                          creator_amount, platform_amount, creator_wallet, platform_wallet, status)
    VALUES (${auth.id}, ${indicatorId}, ${'pending_' + Date.now()}, ${amount},
            ${indicator.price_token || 'SOL'}, ${credits}, ${amount * 0.5}, ${amount * 0.5},
            ${creatorWallet}, ${PLATFORM_WALLET}, 'pending')
    RETURNING id
  `;
  res.json({ paymentId: payments[0].id, amount, token: indicator.price_token || 'SOL', recipientWallet: PLATFORM_WALLET, memo: 'pmsi:' + payments[0].id, apiKeyId });
}

async function handleVerify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const { paymentId, txSignature } = req.body || {};
  if (!paymentId || !txSignature) return res.status(400).json({ error: 'paymentId and txSignature required' });

  const sql = getDb();
  const payments = await sql`SELECT * FROM payments WHERE id = ${paymentId} AND buyer_id = ${auth.id} AND status = 'pending'`;
  if (payments.length === 0) return res.status(404).json({ error: 'Payment not found or already verified' });

  const payment = payments[0];
  const { verified, error } = await verifyTransaction(txSignature, parseFloat(payment.amount), 'pmsi:' + paymentId);
  if (!verified) return res.status(400).json({ error: 'Transaction verification failed: ' + error });

  await sql`UPDATE payments SET tx_signature = ${txSignature}, status = 'confirmed', confirmed_at = now() WHERE id = ${paymentId}`;
  const keys = await sql`SELECT id FROM api_keys WHERE user_id = ${auth.id} AND revoked_at IS NULL ORDER BY created_at LIMIT 1`;
  if (keys.length > 0) await sql`UPDATE api_keys SET credits_remaining = credits_remaining + ${payment.credits_purchased} WHERE id = ${keys[0].id}`;

  res.json({ verified: true, credits: payment.credits_purchased, txSignature });
}
