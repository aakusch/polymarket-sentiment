const { getDb } = require('./db');

let _migrated = false;

async function ensureBundlePricing() {
  if (_migrated) return;
  const sql = getDb();
  try {
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_10 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_50 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_100 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_500 NUMERIC(12,6)`;
    await sql`
      CREATE TABLE IF NOT EXISTS api_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        api_key_id UUID NOT NULL,
        indicator_id UUID,
        endpoint TEXT,
        response_ms INTEGER,
        called_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    _migrated = true;
  } catch (err) {
    console.error('Migration note:', err.message);
    _migrated = true;
  }
}

let _forkMigrated = false;

async function ensureForkColumns() {
  if (_forkMigrated) return;
  const sql = getDb();
  try {
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS forked_from TEXT`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS fork_count INTEGER DEFAULT 0`;
    await sql`UPDATE indicators SET published_at = created_at WHERE is_public = true AND published_at IS NULL`;
    _forkMigrated = true;
  } catch (err) {
    console.error('Fork migration note:', err.message);
    _forkMigrated = true;
  }
}

module.exports = { ensureBundlePricing, ensureForkColumns };
