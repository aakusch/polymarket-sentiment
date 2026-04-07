const { getDb } = require('./db');

let _migrated = false;

async function ensureTokenColumns() {
  if (_migrated) return;
  const sql = getDb();
  try {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_calls_today INTEGER DEFAULT 0`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_calls_date DATE`;
    await sql`
      CREATE TABLE IF NOT EXISTS api_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        api_key_id UUID NOT NULL,
        indicator_id UUID,
        endpoint TEXT,
        response_ms INTEGER,
        credit_source TEXT DEFAULT 'db',
        called_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    _migrated = true;
  } catch (err) {
    console.error('Migration note:', err.message);
    _migrated = true;
  }
}

module.exports = { ensureTokenColumns };
