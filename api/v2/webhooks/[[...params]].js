const crypto = require('crypto');
const { getDb } = require('../../_lib/db');
const { validateApiKey } = require('../../_lib/apikey');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await validateApiKey(req, res, { deductCredit: false, endpoint: '/v2/webhooks' });
  if (!auth) return;

  const raw = req.query.params ?? req.query["[...params]"]; const params = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const webhookId = params[0];
  const sql = auth.sql;

  await sql`
    CREATE TABLE IF NOT EXISTS webhooks (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      indicator_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT[] DEFAULT '{"score_update"}',
      enabled BOOLEAN DEFAULT true,
      last_delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // DELETE /api/v2/webhooks/:id
  if (webhookId && req.method === 'DELETE') {
    const rows = await sql`DELETE FROM webhooks WHERE id = ${webhookId} AND user_id = ${auth.key.user_id} RETURNING id`;
    if (rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
    return res.json({ deleted: true });
  }

  // PATCH /api/v2/webhooks/:id
  if (webhookId && req.method === 'PATCH') {
    const { enabled, url, events } = req.body;
    const updates = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (url) { try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); } updates.url = url; }
    if (events && Array.isArray(events)) updates.events = events.filter(e => ['score_update', 'threshold_cross'].includes(e));
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const rows = await sql`
      UPDATE webhooks SET
        enabled = COALESCE(${updates.enabled ?? null}, enabled),
        url = COALESCE(${updates.url ?? null}, url),
        events = COALESCE(${updates.events ?? null}, events)
      WHERE id = ${webhookId} AND user_id = ${auth.key.user_id} RETURNING *
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
    return res.json(rows[0]);
  }

  // GET /api/v2/webhooks
  if (!webhookId && req.method === 'GET') {
    const rows = await sql`
      SELECT w.id, w.indicator_id, w.url, w.events, w.enabled, w.last_delivered_at, w.created_at, i.name as indicator_name
      FROM webhooks w LEFT JOIN indicators i ON w.indicator_id = i.id::text
      WHERE w.user_id = ${auth.key.user_id} ORDER BY w.created_at DESC
    `;
    return res.json({ webhooks: rows.map(r => ({ id: r.id, indicatorId: r.indicator_id, indicatorName: r.indicator_name, url: r.url, events: r.events, enabled: r.enabled, lastDeliveredAt: r.last_delivered_at, createdAt: r.created_at })) });
  }

  // POST /api/v2/webhooks
  if (!webhookId && req.method === 'POST') {
    const { indicatorId, url, events } = req.body;
    if (!indicatorId || !url) return res.status(400).json({ error: 'Missing required fields: indicatorId, url' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid webhook URL' }); }

    const ind = await sql`SELECT id FROM indicators WHERE id = ${indicatorId} AND is_public = true`;
    if (ind.length === 0) return res.status(404).json({ error: 'Indicator not found or not public' });

    const count = await sql`SELECT COUNT(*) as cnt FROM webhooks WHERE user_id = ${auth.key.user_id}`;
    if (parseInt(count[0].cnt) >= 10) return res.status(400).json({ error: 'Maximum 10 webhooks per user' });

    const secret = crypto.randomBytes(32).toString('hex');
    const validEvents = (events || ['score_update']).filter(e => ['score_update', 'threshold_cross'].includes(e));
    const rows = await sql`
      INSERT INTO webhooks (user_id, indicator_id, url, secret, events)
      VALUES (${auth.key.user_id}, ${indicatorId}, ${url}, ${secret}, ${validEvents})
      RETURNING id, indicator_id, url, events, enabled, created_at
    `;
    return res.status(201).json({ ...rows[0], secret });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
