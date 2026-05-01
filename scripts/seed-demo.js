/**
 * Seed demo indicators for all sectors.
 * Run: DATABASE_URL=... node scripts/seed-demo.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  for (const file of ['.env.local', '.env']) {
    const full = path.join(__dirname, '..', file);
    if (!fs.existsSync(full)) continue;
    for (const raw of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      value = value.replace(/\\n/g, '').trim();
      if (key && process.env[key] == null) process.env[key] = value;
    }
  }
}

loadLocalEnv();

const DATABASE_URL = (process.env.DATABASE_URL || '').replace(/\\n/g, '').trim();
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const sql = neon(DATABASE_URL);

const DEMO_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'demo@pmsi.app',
  display_name: 'PMSI Team',
  wallet_address: null,
};

const DEMO_INDICATORS = [
  // ── Crypto ──────────────────────────────────────────────────
  {
    id: 'demo-btc-sentiment',
    name: 'BTC Sentiment Index',
    sector: 'crypto',
    asset: 'BTC',
    weights: { price_targets: 100, regulatory: 80, adoption: 60, events: 60 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-eth-momentum',
    name: 'ETH Momentum',
    sector: 'crypto',
    asset: 'ETH',
    weights: { price_targets: 200, regulatory: 40, adoption: 80, events: 40 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-crypto-regulatory',
    name: 'Crypto Regulatory Pulse',
    sector: 'crypto',
    asset: 'BTC',
    weights: { price_targets: 30, regulatory: 200, adoption: 40, events: 40 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-crypto-fg',
    name: 'BTC Fear & Greed Blend',
    sector: 'crypto',
    asset: 'BTC',
    weights: { price_targets: 100, regulatory: 60, adoption: 60, events: 60 },
    fg_enabled: true,
    fg_weight: 50,
  },

  // ── Stocks ──────────────────────────────────────────────────
  {
    id: 'demo-spx-sentiment',
    name: 'S&P 500 Sentiment',
    sector: 'stocks',
    asset: 'SPX',
    weights: { price_targets: 100, earnings: 80, corporate: 60 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-tech-pulse',
    name: 'Tech Mega-Cap Pulse',
    sector: 'stocks',
    asset: 'NDX',
    weights: { price_targets: 150, earnings: 150, corporate: 40 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-earnings-signal',
    name: 'Earnings Season Signal',
    sector: 'stocks',
    asset: 'SPX',
    weights: { price_targets: 40, earnings: 200, corporate: 80 },
    fg_enabled: false,
    fg_weight: 30,
  },

  // ── Economy ─────────────────────────────────────────────────
  {
    id: 'demo-fed-outlook',
    name: 'Fed Policy Outlook',
    sector: 'economy',
    asset: 'FED',
    weights: { monetary_policy: 200, inflation: 80, growth: 40, employment: 40 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-recession-watch',
    name: 'Recession Watch',
    sector: 'economy',
    asset: 'GDP',
    weights: { monetary_policy: 60, inflation: 60, growth: 200, employment: 150 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-macro-index',
    name: 'Macro Sentiment Index',
    sector: 'economy',
    asset: 'FED',
    weights: { monetary_policy: 100, inflation: 100, growth: 100, employment: 100 },
    fg_enabled: false,
    fg_weight: 30,
  },

  // ── Politics ────────────────────────────────────────────────
  {
    id: 'demo-election-barometer',
    name: 'Election Barometer',
    sector: 'politics',
    asset: 'GOP',
    weights: { favors_incumbent: 150, favors_challenger: 150, legislative: 30, judicial: 20, geopolitical: 20 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-policy-impact',
    name: 'Policy Impact Index',
    sector: 'politics',
    asset: 'SENATE',
    weights: { favors_incumbent: 30, favors_challenger: 30, legislative: 150, judicial: 100, geopolitical: 100 },
    fg_enabled: false,
    fg_weight: 30,
  },
  {
    id: 'demo-political-sentiment',
    name: 'Political Sentiment',
    sector: 'politics',
    asset: 'DEM',
    weights: { favors_incumbent: 100, favors_challenger: 100, legislative: 80, judicial: 60, geopolitical: 60 },
    fg_enabled: false,
    fg_weight: 30,
  },
];

async function seed() {
  // Ensure tables exist
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      password_hash TEXT,
      wallet_address TEXT UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS indicators (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT 'crypto',
      asset TEXT NOT NULL DEFAULT 'BTC',
      weights JSONB NOT NULL,
      markets JSONB,
      fg_enabled BOOLEAN DEFAULT false,
      fg_weight INTEGER DEFAULT 30,
      include_other BOOLEAN DEFAULT false,
      is_public BOOLEAN DEFAULT true,
      latest_score NUMERIC,
      view_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      price_per_100 NUMERIC(12,6),
      price_bundle_10 NUMERIC(12,6),
      price_bundle_50 NUMERIC(12,6),
      price_bundle_100 NUMERIC(12,6),
      price_bundle_500 NUMERIC(12,6),
      price_token TEXT DEFAULT 'SOL',
      published_at TIMESTAMPTZ,
      forked_from TEXT,
      fork_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  // Add columns if missing (existing tables)
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS markets JSONB`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS latest_score NUMERIC`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_10 NUMERIC(12,6)`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_50 NUMERIC(12,6)`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_100 NUMERIC(12,6)`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS price_bundle_500 NUMERIC(12,6)`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS forked_from TEXT`.catch(() => {});
  await sql`ALTER TABLE indicators ADD COLUMN IF NOT EXISTS fork_count INTEGER DEFAULT 0`.catch(() => {});
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
  `.catch(() => {});
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
  `.catch(() => {});

  // Upsert demo user
  await sql`
    INSERT INTO users (id, email, display_name, wallet_address)
    VALUES (${DEMO_USER.id}, ${DEMO_USER.email}, ${DEMO_USER.display_name}, ${DEMO_USER.wallet_address})
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
  `;
  console.log('Demo user ready:', DEMO_USER.display_name);

  // Upsert indicators
  for (const ind of DEMO_INDICATORS) {
    await sql`
      INSERT INTO indicators (id, user_id, name, sector, asset, weights, fg_enabled, fg_weight, include_other, is_public)
      VALUES (
        ${ind.id}, ${DEMO_USER.id}, ${ind.name}, ${ind.sector}, ${ind.asset},
        ${JSON.stringify(ind.weights)}, ${ind.fg_enabled}, ${ind.fg_weight},
        false, true
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, sector = EXCLUDED.sector, asset = EXCLUDED.asset,
        weights = EXCLUDED.weights, fg_enabled = EXCLUDED.fg_enabled, fg_weight = EXCLUDED.fg_weight,
        is_public = true, updated_at = now()
    `;
    console.log(`  ${ind.sector.padEnd(8)} | ${ind.name}`);
  }

  console.log(`\nSeeded ${DEMO_INDICATORS.length} demo indicators across ${[...new Set(DEMO_INDICATORS.map(i => i.sector))].length} sectors`);
}

seed().catch(e => { console.error(e); process.exit(1); });
