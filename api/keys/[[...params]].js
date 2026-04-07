const crypto = require('crypto');
const { getDb } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const params = req.query.params || [];
  const keyId = params[0];
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT,
      credits_remaining INTEGER DEFAULT 0,
      rate_limit_per_min INTEGER DEFAULT 60,
      created_at TIMESTAMPTZ DEFAULT now(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    )
  `;

  // DELETE /api/keys/:id — revoke key
  if (keyId && req.method === 'DELETE') {
    const rows = await sql`
      UPDATE api_keys SET revoked_at = now()
      WHERE id = ${keyId} AND user_id = ${auth.id} AND revoked_at IS NULL
      RETURNING id
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    return res.json({ revoked: true });
  }

  // GET /api/keys — list keys
  if (!keyId && req.method === 'GET') {
    const rows = await sql`
      SELECT id, key_prefix as prefix, label, credits_remaining as credits,
             revoked_at IS NOT NULL as revoked, created_at, last_used_at
      FROM api_keys WHERE user_id = ${auth.id}
      ORDER BY created_at DESC
    `;
    return res.json(rows);
  }

  // POST /api/keys — create key
  if (!keyId && req.method === 'POST') {
    const { label } = req.body || {};
    const count = await sql`SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ${auth.id} AND revoked_at IS NULL`;
    if (parseInt(count[0].cnt) >= 5) return res.status(400).json({ error: 'Maximum 5 active API keys' });

    const raw = 'pmsi_sk_' + crypto.randomBytes(24).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix = raw.slice(0, 12);
    await sql`INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (${auth.id}, ${hash}, ${prefix}, ${label || null})`;
    return res.status(201).json({ key: raw, prefix });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
