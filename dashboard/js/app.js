// ── Sector Data Cache & Loading ──────────────────────────────────────────

const sectorDataCache = {};

async function loadSectorData(sectorId) {
  if (sectorDataCache[sectorId]) return sectorDataCache[sectorId];

  const sector = SECTORS[sectorId];
  if (!sector || !sector.available || !sector.dataFiles.sandbox) return null;

  try {
    const [sandbox, latest] = await Promise.all([
      fetch(sector.dataFiles.sandbox).then(r => r.json()),
      fetch(sector.dataFiles.latest).then(r => r.json()),
    ]);

    // Build reference map from sandbox ref data
    const ref = sandbox.ref;
    const refMap = {};
    ref.dates.forEach((d, i) => {
      const entry = {};
      if (sector.referenceData.priceKey) {
        entry[sector.referenceData.priceKey] = ref[sector.referenceData.priceKey]?.[i];
      }
      for (const sig of sector.referenceData.externalSignals) {
        entry[sig.key] = ref[sig.key]?.[i];
      }
      refMap[d] = entry;
    });

    sectorDataCache[sectorId] = { sandbox, latest, refMap };
    return sectorDataCache[sectorId];
  } catch (e) {
    console.error(`Failed to load data for sector "${sectorId}":`, e);
    return null;
  }
}

// ── Indicator Migration ─────────────────────────────────────────────────

function migrateIndicators() {
  const raw = localStorage.getItem('pcsi_indicators');
  if (!raw) return;
  try {
    const indicators = JSON.parse(raw);
    let changed = false;
    for (const ind of indicators) {
      if (!ind.sector) {
        ind.sector = 'crypto';
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('pcsi_indicators', JSON.stringify(indicators));
    }
  } catch (_) {}
}

// ── Hash Router ─────────────────────────────────────────────────────────

function handleRoute() {
  const hash = location.hash || '#indicators';
  const page = hash.split('?')[0].replace('#', '') || 'indicators';

  // Show/hide pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  else document.getElementById('page-indicators')?.classList.add('active');

  // Update nav
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === page);
  });

  switch (page) {
    case 'indicators':
      renderIndicatorsPage();
      break;
    case 'builder':
      renderBuilderPage();
      break;
    case 'api':
      if (typeof renderApiPanel === 'function') renderApiPanel();
      break;
    default:
      document.getElementById('page-indicators')?.classList.add('active');
      document.querySelector('[data-nav="indicators"]')?.classList.add('active');
      renderIndicatorsPage();
      break;
  }
}

window.addEventListener('hashchange', handleRoute);

// ── Score Utilities ─────────────────────────────────────────────────────

function scoreColor(n) {
  if (n <= 50) {
    const r = 220;
    const g = Math.round((n / 50) * 180);
    const b = Math.round((n / 50) * 30);
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(220 - ((n - 50) / 50) * 180);
  const g = 180 + Math.round(((n - 50) / 50) * 20);
  const b = 30 + Math.round(((n - 50) / 50) * 30);
  return `rgb(${r},${g},${b})`;
}

function scoreLabel(n) {
  if (n < 20) return 'Strongly Bearish';
  if (n < 40) return 'Bearish';
  if (n < 60) return 'Neutral';
  if (n < 80) return 'Bullish';
  return 'Strongly Bullish';
}

function fmt$(n) {
  if (n == null) return '--';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtBTC(n) {
  if (n == null) return '--';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ── Boot ────────────────────────────────────────────────────────────────

function init() {
  initAuth();
  migrateIndicators();
  seedDemoIndicators();
  handleRoute();
}

document.addEventListener('DOMContentLoaded', init);
