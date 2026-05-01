const { getDb } = require('./db');

let _migrated = false;

async function ensureBundlePricing() {
  if (_migrated) return;
  const sql = getDb();
  try {
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS markets JSONB`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS latest_score NUMERIC`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_10 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_50 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_100 NUMERIC(12,6)`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_500 NUMERIC(12,6)`;
    await sql`
      CREATE TABLE IF NOT EXISTS api_usage (
        id BIGSERIAL PRIMARY KEY,
        api_key_id UUID NOT NULL,
        indicator_id TEXT,
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

let _observabilityMigrated = false;

async function ensureObservability() {
  if (_observabilityMigrated) return;
  const sql = getDb();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        sector TEXT,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        duration_ms INTEGER,
        scoring_version TEXT,
        summary_json TEXT,
        error TEXT
      )
    `;
    _observabilityMigrated = true;
  } catch (err) {
    console.error('Observability migration note:', err.message);
    _observabilityMigrated = true;
  }
}

let _engagementMigrated = false;

async function ensureEngagement() {
  if (_engagementMigrated) return;
  const sql = getDb();
  try {
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`;
    await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0`;
    await sql`
      CREATE TABLE IF NOT EXISTS indicator_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        indicator_id TEXT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        author_name TEXT,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `;
    _engagementMigrated = true;
  } catch (err) {
    console.error('Engagement migration note:', err.message);
    _engagementMigrated = true;
  }
}

module.exports = { ensureBundlePricing, ensureForkColumns, ensureObservability, ensureEngagement };
