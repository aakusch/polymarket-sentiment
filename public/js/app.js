// ── Sector Data Cache & Loading ──────────────────────────────────────────

const sectorDataCache = {};
const assetDataCache = {};  // { "crypto:BTC": assetPayload }

function buildRefMap(ref) {
  const refMap = {};
  if (!ref?.dates) return refMap;
  // Extract ALL ref keys present in the data (not just sector-declared ones)
  const keys = Object.keys(ref).filter(k => k !== 'dates');
  ref.dates.forEach((d, i) => {
    const entry = {};
    for (const k of keys) {
      entry[k] = ref[k]?.[i];
    }
    refMap[d] = entry;
  });
  return refMap;
}

async function loadSectorData(sectorId) {
  if (sectorDataCache[sectorId]) return sectorDataCache[sectorId];

  const sector = SECTORS[sectorId];
  if (!sector || !sector.available || !sector.dataFiles.sandbox) return null;

  try {
    // Try manifest-based loading first (per-asset split files)
    const manifestUrl = sector.dataFiles.sandbox.replace(/sandbox(-\w+)?\.json$/, 'sandbox$1-manifest.json');
    let sandbox, latest, refMap;

    try {
      const [manifest, latestData] = await Promise.all([
        fetch(manifestUrl).then(r => { if (!r.ok) throw new Error('no manifest'); return r.json(); }),
        fetch(sector.dataFiles.latest).then(r => r.json()),
      ]);
      latest = latestData;

      // Load default asset (first in manifest, typically BTC)
      const assetKeys = Object.keys(manifest.assets || {});
      const defaultAsset = assetKeys.includes('BTC') ? 'BTC' : assetKeys[0];

      if (defaultAsset && manifest.assets[defaultAsset]) {
        const assetPayload = await fetch(manifest.assets[defaultAsset].file).then(r => r.json());
        refMap = buildRefMap(assetPayload.ref);

        // Build sandbox structure from single asset
        sandbox = {
          ref: assetPayload.ref,
          assets: { [defaultAsset]: { dates: assetPayload.dates, cats: assetPayload.cats, markets: assetPayload.markets } },
          generated_at: manifest.generated_at,
          _manifest: manifest,
        };
        assetDataCache[sectorId + ':' + defaultAsset] = true;
      } else {
        throw new Error('no assets in manifest');
      }
    } catch (_) {
      // Fallback: load monolithic sandbox.json
      const [sandboxData, latestData] = await Promise.all([
        fetch(sector.dataFiles.sandbox).then(r => r.json()),
        fetch(sector.dataFiles.latest).then(r => r.json()),
      ]);
      sandbox = sandboxData;
      latest = latestData;
      refMap = buildRefMap(sandbox.ref);
    }

    sectorDataCache[sectorId] = { sandbox, latest, refMap };
    return sectorDataCache[sectorId];
  } catch (e) {
    console.error(`Failed to load data for sector "${sectorId}":`, e);
    return null;
  }
}

async function loadAssetData(sectorId, asset) {
  const cacheKey = sectorId + ':' + asset;
  if (assetDataCache[cacheKey]) return true;

  const cached = sectorDataCache[sectorId];
  if (!cached?.sandbox?._manifest) return true; // monolithic mode, all data loaded

  const manifest = cached.sandbox._manifest;
  const assetMeta = manifest.assets?.[asset];
  if (!assetMeta) return false;

  try {
    const assetPayload = await fetch(assetMeta.file).then(r => r.json());
    // Merge into existing sandbox structure
    if (!cached.sandbox.assets) cached.sandbox.assets = {};
    cached.sandbox.assets[asset] = {
      dates: assetPayload.dates,
      cats: assetPayload.cats,
      markets: assetPayload.markets,
    };
    assetDataCache[cacheKey] = true;
    return true;
  } catch (e) {
    console.error(`Failed to load asset data for ${asset}:`, e);
    return false;
  }
}

// ── Multi-sector loading helper ────────────────────────────────────────

async function ensureSectorsLoaded(sectorIds) {
  const toLoad = sectorIds.filter(s => !sectorDataCache[s] && SECTORS[s]?.available);
  if (toLoad.length > 0) {
    await Promise.all(toLoad.map(s => loadSectorData(s)));
  }
}

// ── Indicator Migration ─────────────────────────────────────────────────

function migrateIndicators() {
  const raw = localStorage.getItem('pcsi_indicators');
  if (!raw) return;
  try {
    const indicators = JSON.parse(raw);
    // Remove demo indicators from localStorage
    const filtered = indicators.filter(ind => !ind.id?.startsWith('demo'));
    if (filtered.length !== indicators.length) {
      localStorage.setItem('pcsi_indicators', JSON.stringify(filtered));
    }
    // Add default sector if missing
    let changed = false;
    for (const ind of filtered) {
      if (!ind.sector) {
        ind.sector = 'crypto';
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('pcsi_indicators', JSON.stringify(filtered));
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

  // Update nav — indicator detail is a child of indicators
  const navPage = page === 'indicator' ? 'indicators' : page;
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === navPage);
  });

  switch (page) {
    case 'indicators':
      renderIndicatorsPage();
      break;
    case 'indicator':
      if (typeof renderIndicatorDetail === 'function') renderIndicatorDetail();
      break;
    case 'builder':
      renderBuilderPage();
      break;
    case 'api':
      if (typeof renderApiPanel === 'function') renderApiPanel();
      break;
    case 'docs':
      if (typeof renderDocsPage === 'function') renderDocsPage();
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

// ── Freshness Badge ─────────────────────────────────────────────────────

async function updateFreshnessBadge() {
  try {
    const data = sectorDataCache['crypto'];
    const generatedAt = data?.latest?.generated_at || data?.sandbox?.generated_at;
    if (!generatedAt) return;

    const gen = new Date(generatedAt);
    const now = new Date();
    const diffMs = now - gen;
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffH / 24);

    let text, dotColor, textColor;
    if (diffH < 1) {
      text = '<1h ago';
      dotColor = '#4ade80'; textColor = 'text-green-400';
    } else if (diffH < 6) {
      text = diffH + 'h ago';
      dotColor = '#4ade80'; textColor = 'text-green-400';
    } else if (diffH < 24) {
      text = diffH + 'h ago';
      dotColor = '#fbbf24'; textColor = 'text-yellow-400';
    } else {
      text = diffD + 'd ago';
      dotColor = '#f87171'; textColor = 'text-red-400';
    }

    const el = document.getElementById('nav-score');
    if (el) {
      el.innerHTML = `
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800/60 border border-gray-700/50" title="Last data sync: ${gen.toLocaleString()}">
            <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block"></span>
            <span class="text-xs text-gray-400">Synced</span>
            <span class="text-xs font-medium ${textColor}">${text}</span>
          </div>
          <button onclick="triggerSync()" id="sync-btn" class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-gray-400 bg-gray-800/60 border border-gray-700/50 hover:border-blue-500/50 hover:text-blue-400 transition-colors" title="Refresh data">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Sync
          </button>
        </div>`;
    }
  } catch (_) {}
}

async function triggerSync() {
  const btn = document.getElementById('sync-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Syncing...';

  // Clear cached data and reload all sectors
  for (const key of Object.keys(sectorDataCache)) delete sectorDataCache[key];
  for (const key of Object.keys(assetDataCache)) delete assetDataCache[key];

  try {
    const loads = SECTOR_ORDER.filter(s => SECTORS[s]?.available).map(s => loadSectorData(s));
    await Promise.all(loads);
    await updateFreshnessBadge();
    handleRoute(); // Re-render current page with fresh data
  } catch (_) {}

  btn.disabled = false;
}

// ── Boot ────────────────────────────────────────────────────────────────

function init() {
  initAuth();
  migrateIndicators();
  handleRoute();
  // Show freshness badge once crypto data loads
  loadSectorData('crypto').then(updateFreshnessBadge);
}

document.addEventListener('DOMContentLoaded', init);
