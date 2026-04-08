const { getDb } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  const auth = authenticate(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const raw = req.query.params ?? req.query["[...params]"]; const params = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const alertId = params[0];
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      indicator_id TEXT NOT NULL,
      condition TEXT NOT NULL CHECK (condition IN ('crosses_above', 'crosses_below', 'daily_summary')),
      threshold NUMERIC,
      channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook', 'discord')),
      destination TEXT NOT NULL,
      enabled BOOLEAN DEFAULT true,
      last_triggered_at TIMESTAMPTZ,
      last_score NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // DELETE /api/alerts/:id
  if (alertId && req.method === 'DELETE') {
    const rows = await sql`DELETE FROM alerts WHERE id = ${alertId} AND user_id = ${auth.id} RETURNING id`;
    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    return res.json({ deleted: true });
  }

  // PATCH /api/alerts/:id
  if (alertId && req.method === 'PATCH') {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    const rows = await sql`UPDATE alerts SET enabled = ${enabled} WHERE id = ${alertId} AND user_id = ${auth.id} RETURNING *`;
    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    return res.json(rows[0]);
  }

  // GET /api/alerts
  if (!alertId && req.method === 'GET') {
    const alerts = await sql`
      SELECT a.*, i.name as indicator_name, i.asset
      FROM alerts a LEFT JOIN indicators i ON a.indicator_id = i.id::text
      WHERE a.user_id = ${auth.id} ORDER BY a.created_at DESC
    `;
    return res.json(alerts);
  }

  // POST /api/alerts
  if (!alertId && req.method === 'POST') {
    const { indicatorId, condition, threshold, channel, destination } = req.body;
    if (!indicatorId || !condition || !channel || !destination) return res.status(400).json({ error: 'Missing required fields' });
    if (!['crosses_above', 'crosses_below', 'daily_summary'].includes(condition)) return res.status(400).json({ error: 'Invalid condition' });
    if (!['email', 'webhook', 'discord'].includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
    if (condition !== 'daily_summary' && (threshold == null || threshold < 0 || threshold > 100)) return res.status(400).json({ error: 'Threshold must be 0-100' });

    const ind = await sql`SELECT id FROM indicators WHERE id = ${indicatorId} AND is_public = true`;
    if (ind.length === 0) return res.status(404).json({ error: 'Indicator not found or not public' });

    const count = await sql`SELECT COUNT(*) as cnt FROM alerts WHERE user_id = ${auth.id}`;
    if (parseInt(count[0].cnt) >= 20) return res.status(400).json({ error: 'Maximum 20 alerts per user' });

    const rows = await sql`
      INSERT INTO alerts (user_id, indicator_id, condition, threshold, channel, destination)
      VALUES (${auth.id}, ${indicatorId}, ${condition}, ${threshold || null}, ${channel}, ${destination})
      RETURNING *
    `;
    return res.status(201).json(rows[0]);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
