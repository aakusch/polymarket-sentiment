const { getDb } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');
const { verifyTransaction } = require('../_lib/solana');
const { ensureBundlePricing } = require('../_lib/migrations');

const PLATFORM_WALLET = process.env.PLATFORM_WALLET;
const VALID_BUNDLES = [10, 50, 100, 500];

module.exports = async function handler(req, res) {
  const { action } = req.query;

  switch (action) {
    case 'balance': return handleBalance(req, res);
    case 'bundles': return handleBundles(req, res);
    case 'purchase': return handlePurchase(req, res);
    case 'verify': return handleVerify(req, res);
    default: return res.status(404).json({ error: 'Not found' });
  }
};

async function handleBalance(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const sql = getDb();
  const rows = await sql`
    SELECT COALESCE(SUM(credits_remaining), 0) as total
    FROM api_keys WHERE user_id = ${auth.id} AND revoked_at IS NULL
  `;
  const credits = parseInt(rows[0].total);
  return res.json({ credits });
}

async function handleBundles(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { indicatorId } = req.query;
  if (!indicatorId) return res.status(400).json({ error: 'indicatorId query param required' });

  await ensureBundlePricing();

  const sql = getDb();
  const rows = await sql`
    SELECT id, name, price_bundle_10, price_bundle_50, price_bundle_100, price_bundle_500
    FROM indicators WHERE id = ${indicatorId} AND is_public = true
  `;
  if (rows.length === 0) return res.status(404).json({ error: 'Indicator not found' });

  const ind = rows[0];
  const bundles = VALID_BUNDLES.map(tier => ({
    calls: tier,
    price: ind[`price_bundle_${tier}`] ? parseFloat(ind[`price_bundle_${tier}`]) : null,
  }));

  res.setHeader('Cache-Control', 's-maxage=60');
  return res.json({ indicatorId: ind.id, name: ind.name, bundles });
}

async function handlePurchase(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  await ensureBundlePricing();

  const { indicatorId, bundle, apiKeyId } = req.body || {};
  if (!indicatorId || !bundle || !VALID_BUNDLES.includes(bundle)) {
    return res.status(400).json({ error: 'indicatorId and bundle (10, 50, 100, or 500) required' });
  }

  const sql = getDb();
  const indicators = await sql`
    SELECT id, price_bundle_10, price_bundle_50, price_bundle_100, price_bundle_500, user_id
    FROM indicators WHERE id = ${indicatorId}
  `;
  if (indicators.length === 0) return res.status(404).json({ error: 'Indicator not found' });

  const indicator = indicators[0];
  const priceCol = `price_bundle_${bundle}`;
  const price = indicator[priceCol] ? parseFloat(indicator[priceCol]) : null;

  if (price == null || price === 0) {
    // Free tier — add credits directly
    if (apiKeyId) {
      await sql`UPDATE api_keys SET credits_remaining = credits_remaining + ${bundle} WHERE id = ${apiKeyId} AND user_id = ${auth.id}`;
    }
    return res.json({ free: true, credits: bundle });
  }

  const creators = await sql`SELECT wallet_address FROM users WHERE id = ${indicator.user_id}`;
  const creatorWallet = creators[0]?.wallet_address || PLATFORM_WALLET;

  const payments = await sql`
    INSERT INTO payments (buyer_id, indicator_id, tx_signature, amount, token, credits_purchased,
                          creator_amount, platform_amount, creator_wallet, platform_wallet, status)
    VALUES (${auth.id}, ${indicatorId}, ${'pending_' + Date.now()}, ${price},
            'SOL', ${bundle}, ${price * 0.5}, ${price * 0.5},
            ${creatorWallet}, ${PLATFORM_WALLET}, 'pending')
    RETURNING id
  `;
  res.json({
    paymentId: payments[0].id,
    amount: price,
    token: 'SOL',
    credits: bundle,
    recipientWallet: PLATFORM_WALLET,
    memo: 'pmsi:' + payments[0].id,
    apiKeyId,
  });
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
