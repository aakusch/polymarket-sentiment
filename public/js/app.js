// ── Sector Data Cache & Loading ──────────────────────────────────────────

const sectorDataCache = {};
const assetDataCache = {};  // { "crypto:BTC": assetPayload }
let dataRefreshNonce = '';
let syncInFlight = false;
let metaCache = null;

function dataUrl(url) {
  if (!dataRefreshNonce) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(dataRefreshNonce);
}

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

async function loadMetaData() {
  try {
    metaCache = await fetch(dataUrl('data/meta.json'), { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error('meta unavailable');
      return r.json();
    });
  } catch (_) {
    metaCache = null;
  }
  return metaCache;
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
        fetch(dataUrl(manifestUrl), { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('no manifest'); return r.json(); }),
        fetch(dataUrl(sector.dataFiles.latest), { cache: 'no-store' }).then(r => r.json()),
      ]);
      latest = latestData;

      // Load default asset (first in manifest, typically BTC)
      const assetKeys = Object.keys(manifest.assets || {});
      const defaultAsset = assetKeys.includes('BTC') ? 'BTC' : assetKeys[0];

      if (defaultAsset && manifest.assets[defaultAsset]) {
        const assetPayload = await fetch(dataUrl(manifest.assets[defaultAsset].file), { cache: 'no-store' }).then(r => r.json());
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
        fetch(dataUrl(sector.dataFiles.sandbox), { cache: 'no-store' }).then(r => r.json()),
        fetch(dataUrl(sector.dataFiles.latest), { cache: 'no-store' }).then(r => r.json()),
      ]);
      sandbox = sandboxData;
      latest = latestData;
      refMap = buildRefMap(sandbox.ref);
    }

    sectorDataCache[sectorId] = { sandbox, latest, refMap };
    if (typeof invalidateMarketHistoryIndex === 'function') invalidateMarketHistoryIndex();
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
    const assetPayload = await fetch(dataUrl(assetMeta.file), { cache: 'no-store' }).then(r => r.json());
    // Merge into existing sandbox structure
    if (!cached.sandbox.assets) cached.sandbox.assets = {};
    cached.sandbox.assets[asset] = {
      dates: assetPayload.dates,
      cats: assetPayload.cats,
      markets: assetPayload.markets,
    };
    assetDataCache[cacheKey] = true;
    if (typeof invalidateMarketHistoryIndex === 'function') invalidateMarketHistoryIndex();
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

async function ensureAllSectorAssetsLoaded(sectorIds) {
  await ensureSectorsLoaded(sectorIds);
  const loads = [];
  for (const sectorId of sectorIds) {
    const manifest = sectorDataCache[sectorId]?.sandbox?._manifest;
    for (const asset of Object.keys(manifest?.assets || {})) {
      loads.push(loadAssetData(sectorId, asset));
    }
  }
  if (loads.length > 0) await Promise.all(loads);
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

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Freshness Badge ─────────────────────────────────────────────────────

function syncIcon(spin = false) {
  return `<svg class="w-3 h-3${spin ? ' animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`;
}

function getLatestGeneratedAt() {
  const metaDates = Object.values(metaCache?.sectors || {})
    .map(s => s?.generated_at)
    .filter(Boolean)
    .map(raw => new Date(raw))
    .filter(d => Number.isFinite(d.getTime()));
  const dataDates = Object.values(sectorDataCache)
    .map(data => data?.latest?.generated_at || data?.sandbox?.generated_at)
    .filter(Boolean)
    .map(raw => new Date(raw))
    .filter(d => Number.isFinite(d.getTime()));
  const dates = [...metaDates, ...dataDates];
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map(d => d.getTime())));
}

function getFreshnessTitle(generatedAt) {
  if (!generatedAt) return 'No generated data has loaded yet';
  const sectorEntries = Object.entries(metaCache?.sectors || {});
  const sectorSummary = sectorEntries.length
    ? sectorEntries.map(([id, s]) => `${id}: ${s.latest_date || 'no date'} (${s.status || 'unknown'})`).join('\n')
    : 'Sector metadata unavailable';
  const scoreVersion = metaCache?.scoring_version ? `\nScoring: ${metaCache.scoring_version}` : '';
  return `Generated: ${generatedAt.toLocaleString()}${scoreVersion}\n${sectorSummary}`;
}

function getFreshnessMeta(generatedAt) {
  if (!generatedAt) {
    return { label: 'Data unavailable', age: '--', dot: '#6b7280', textClass: 'text-gray-400' };
  }
  const now = new Date();
  const diffMs = Math.max(0, now - generatedAt);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);

  if (diffH < 6) {
    return { label: 'Data current', age: diffH < 1 ? '<1h ago' : diffH + 'h ago', dot: '#4ade80', textClass: 'text-green-400' };
  }
  if (diffH < 24) {
    return { label: 'Data aging', age: diffH + 'h ago', dot: '#fbbf24', textClass: 'text-yellow-400' };
  }
  return { label: 'Data stale', age: diffD + 'd ago', dot: '#f87171', textClass: 'text-red-400' };
}

async function updateFreshnessBadge(state = 'idle', message = '') {
  try {
    const el = document.getElementById('nav-score');
    if (!el) return;

    const generatedAt = getLatestGeneratedAt();
    const meta = getFreshnessMeta(generatedAt);
    const title = escapeAttr(getFreshnessTitle(generatedAt));
    const busy = state === 'refreshing';
    const failed = state === 'error';
    const updated = state === 'updated';
    const buttonText = busy ? 'Refreshing' : failed ? 'Retry' : updated ? 'Updated' : 'Refresh View';
    const statusLabel = failed ? 'Refresh failed' : updated ? 'View refreshed' : meta.label;
    const statusAge = message || meta.age;
    const dotColor = failed ? '#f87171' : updated ? '#4ade80' : meta.dot;
    const statusTextClass = failed ? 'text-red-400' : updated ? 'text-green-400' : meta.textClass;

    el.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="data-status flex items-center gap-1.5 px-2.5 py-1 rounded-full" title="${title}">
          <span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block"></span>
          <span class="text-xs text-gray-400">${statusLabel}</span>
          <span class="text-xs font-medium ${statusTextClass}">${statusAge}</span>
        </div>
        <button onclick="triggerSync()" id="sync-btn" ${busy ? 'disabled' : ''} class="sync-btn flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-gray-400 transition-colors" title="Reload published data files and repaint the current view. This does not run collection.">
          ${syncIcon(busy)}
          <span>${buttonText}</span>
        </button>
      </div>`;
  } catch (_) {}
}

async function triggerSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  dataRefreshNonce = Date.now().toString();
  await updateFreshnessBadge('refreshing');

  // Clear cached data and reload all static sector files. Collection still runs in the pipeline/workflow.
  for (const key of Object.keys(sectorDataCache)) delete sectorDataCache[key];
  for (const key of Object.keys(assetDataCache)) delete assetDataCache[key];
  metaCache = null;
  if (typeof invalidateMarketHistoryIndex === 'function') invalidateMarketHistoryIndex();
  if (typeof _indicatorCache !== 'undefined') _indicatorCache = null;

  try {
    await loadMetaData();
    const loads = SECTOR_ORDER.filter(s => SECTORS[s]?.available).map(s => loadSectorData(s));
    const loaded = await Promise.all(loads);
    const loadedCount = loaded.filter(Boolean).length;
    if (loadedCount === 0) throw new Error('No sector data loaded');
    handleRoute();
    await updateFreshnessBadge('updated', `${loadedCount} sectors`);
    setTimeout(() => updateFreshnessBadge(), 1600);
  } catch (err) {
    console.error('Data refresh failed:', err);
    await updateFreshnessBadge('error', 'Check data files');
    setTimeout(() => updateFreshnessBadge(), 2400);
  } finally {
    syncInFlight = false;
  }
}

// ── Boot ────────────────────────────────────────────────────────────────

function init() {
  initAuth();
  migrateIndicators();
  handleRoute();
  // Show freshness badge once crypto data loads
  Promise.all([loadMetaData(), loadSectorData('crypto')]).then(() => updateFreshnessBadge());
}

document.addEventListener('DOMContentLoaded', init);
