const fs = require('fs/promises');
const path = require('path');
const { getDb } = require('./_lib/db');
const { ensureObservability } = require('./_lib/migrations');

async function readStaticMeta() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', 'data', 'meta.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function readDatabaseHealth() {
  if (!process.env.DATABASE_URL) {
    return { configured: false, status: 'missing' };
  }

  const sql = getDb();
  await ensureObservability();
  const [snapshotRows, runRows] = await Promise.all([
    sql`
      SELECT sector, MAX(date) AS latest_date, COUNT(*) AS snapshots
      FROM sector_snapshots
      GROUP BY sector
      ORDER BY sector
    `,
    sql`
      SELECT id, job_type, sector, status, started_at, finished_at, duration_ms, scoring_version, error
      FROM pipeline_runs
      ORDER BY started_at DESC
      LIMIT 8
    `,
  ]);

  return {
    configured: true,
    status: 'ok',
    snapshots: snapshotRows.map(r => ({
      sector: r.sector,
      latestDate: r.latest_date,
      snapshots: Number(r.snapshots || 0),
    })),
    recentRuns: runRows.map(r => ({
      id: r.id,
      jobType: r.job_type,
      sector: r.sector,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: r.duration_ms,
      scoringVersion: r.scoring_version,
      error: r.error,
    })),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checkedAt = new Date().toISOString();
  const meta = await readStaticMeta();
  let database;
  let status = 'ok';

  try {
    database = await readDatabaseHealth();
    if (database.status !== 'ok') status = 'degraded';
  } catch (err) {
    status = 'degraded';
    database = {
      configured: !!process.env.DATABASE_URL,
      status: 'error',
      error: err.message,
    };
  }

  return res.status(status === 'ok' ? 200 : 503).json({
    service: 'polymarket-sentiment',
    status,
    checkedAt,
    scoringVersion: meta?.scoring_version || null,
    exportSchemaVersion: meta?.schema_version || null,
    staticData: meta ? {
      generatedAt: meta.generated_at || null,
      sectors: meta.sectors || {},
    } : null,
    database,
  });
};
