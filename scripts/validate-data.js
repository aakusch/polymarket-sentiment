#!/usr/bin/env node
/**
 * Validate exported dashboard JSON before committing it from CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const EXPECTED_CATEGORIES = {
  crypto: ['price_targets', 'regulatory', 'adoption', 'events'],
  stocks: ['price_targets', 'earnings', 'corporate'],
  economy: ['monetary_policy', 'inflation', 'growth', 'employment'],
  politics: ['favors_incumbent', 'favors_challenger', 'legislative', 'judicial', 'geopolitical'],
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function fail(message) {
  console.error('Data validation failed:', message);
  process.exitCode = 1;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { maxAgeDays: null, maxFileMb: 25 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-age-days') opts.maxAgeDays = Number(args[++i]);
    else if (args[i] === '--max-file-mb') opts.maxFileMb = Number(args[++i]);
  }
  return opts;
}

// Why: these files are committed to git and fetched whole by the browser. An
// unbounded sandbox export reached 150 MB/sector, past GitHub's 100 MB per-file
// hard limit — which would turn a staleness failure into a push failure with a
// half-committed data dir behind it. Catch it before the commit step runs.
function validateFileSizes(maxFileMb) {
  if (!maxFileMb) return;
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const mb = fs.statSync(path.join(DATA_DIR, name)).size / (1024 * 1024);
    if (mb > maxFileMb) {
      fail(`public/data/${name} is ${mb.toFixed(1)} MB, over the ${maxFileMb} MB limit — tighten the export bounds (--sandbox-days / --sandbox-max-markets)`);
    }
  }
}

function daysOld(dateString) {
  const date = new Date(dateString + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function validateLatest(sector, file, maxAgeDays) {
  const latest = readJson(file);
  if (!latest.date) fail(`${file} is missing date`);
  if (!Number.isFinite(Number(latest.normalized))) fail(`${file} is missing normalized score`);
  if (!latest.sub_scores || typeof latest.sub_scores !== 'object') fail(`${file} is missing sub_scores`);

  const keys = Object.keys(latest.sub_scores).sort();
  const expected = EXPECTED_CATEGORIES[sector].slice().sort();
  const missing = expected.filter(k => !keys.includes(k));
  const unexpected = keys.filter(k => !expected.includes(k));
  if (missing.length || unexpected.length) {
    fail(`${file} has wrong categories. missing=${missing.join(',') || '-'} unexpected=${unexpected.join(',') || '-'}`);
  }

  if (maxAgeDays != null && daysOld(latest.date) > maxAgeDays) {
    fail(`${file} is stale: latest date ${latest.date} exceeds ${maxAgeDays} days`);
  }
}

function main() {
  const { maxAgeDays, maxFileMb } = parseArgs();
  validateFileSizes(maxFileMb);
  const metaPath = path.join(DATA_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) fail('public/data/meta.json is missing');
  if (process.exitCode) return;

  const meta = readJson('public/data/meta.json');
  for (const sector of Object.keys(EXPECTED_CATEGORIES)) {
    const info = meta.sectors?.[sector];
    if (!info?.files?.latest || !info?.files?.sandbox) {
      fail(`meta.json is missing files for ${sector}`);
      continue;
    }
    for (const rel of [info.files.latest, info.files.sandbox]) {
      const full = path.join(DATA_DIR, path.basename(rel));
      if (!fs.existsSync(full)) fail(`${rel} for ${sector} does not exist`);
    }
    validateLatest(sector, path.join('public', info.files.latest), maxAgeDays);
  }

  if (!process.exitCode) console.log('Data validation passed');
}

main();
