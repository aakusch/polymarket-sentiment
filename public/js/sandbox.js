// ── Signals & Builder - Multi-Sector Polymarket Signals ─────────────────────

// ── Builder State ───────────────────────────────────────────────────────────

let builderState = {
  chartInstance: null,
  selectedMarkets: {},  // { marketId: { w: weight, flip: bool } }
  targetSector: 'crypto',
  targetAssetKey: 'btc_price',
  targetAsset: 'BTC',
  fgEnabled: false,
  fgWeight: 30,
  chartPeriod: 'ALL',
  editingId: null,
  initialized: false,
  builderStarted: false,
  marketSearch: '',     // search filter text
  referenceAsset: null, // "Test Against" — key from ALL_REFERENCE_ASSETS (e.g. 'btc_price', 'spx_price', null)
};

let sparklineCharts = [];
let builderForkIndicators = [];

// ── Indicator CRUD (API when authed, localStorage fallback) ─────────────────

let _indicatorCache = null;

const DEFAULT_PUBLIC_INDICATORS = [
  { id: 'demo-btc-sentiment', name: 'BTC Sentiment Index', sector: 'crypto', asset: 'BTC', referenceAsset: 'btc_price', weights: { price_targets: 100, regulatory: 80, adoption: 60, events: 60 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-eth-momentum', name: 'ETH Momentum', sector: 'crypto', asset: 'ETH', referenceAsset: 'eth_price', weights: { price_targets: 200, regulatory: 40, adoption: 80, events: 40 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-crypto-regulatory', name: 'Crypto Regulatory Pulse', sector: 'crypto', asset: 'BTC', referenceAsset: 'btc_price', weights: { price_targets: 30, regulatory: 200, adoption: 40, events: 40 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-crypto-fg', name: 'BTC Fear & Greed Blend', sector: 'crypto', asset: 'BTC', referenceAsset: 'btc_price', weights: { price_targets: 100, regulatory: 60, adoption: 60, events: 60 }, fgEnabled: true, fgWeight: 50 },
  { id: 'demo-spx-sentiment', name: 'S&P 500 Sentiment', sector: 'stocks', asset: 'SPX', referenceAsset: 'spx_price', weights: { price_targets: 100, earnings: 80, corporate: 60 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-tech-pulse', name: 'Tech Mega-Cap Pulse', sector: 'stocks', asset: 'NDX', referenceAsset: 'ndx_price', weights: { price_targets: 150 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-earnings-signal', name: 'Earnings Season Signal', sector: 'stocks', asset: 'SPX', referenceAsset: 'spx_price', weights: { price_targets: 120 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-fed-outlook', name: 'Fed Policy Outlook', sector: 'economy', asset: 'MACRO', referenceAsset: 'fed_rate', weights: { monetary_policy: 200, growth: 80 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-recession-watch', name: 'Recession Watch', sector: 'economy', asset: 'GDP', referenceAsset: 'us10y_yield', weights: { growth: 200 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-macro-index', name: 'Macro Sentiment Index', sector: 'economy', asset: 'MACRO', referenceAsset: 'us10y_yield', weights: { monetary_policy: 100, growth: 100 }, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-election-barometer', name: 'Election Barometer', sector: 'politics', asset: 'GOV', referenceAsset: null, weights: { other: 100 }, includeOther: true, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-policy-impact', name: 'Policy Impact Index', sector: 'politics', asset: 'GOV', referenceAsset: null, weights: { other: 100 }, includeOther: true, fgEnabled: false, fgWeight: 30 },
  { id: 'demo-political-sentiment', name: 'Political Sentiment', sector: 'politics', asset: 'GOV', referenceAsset: null, weights: { other: 100 }, includeOther: true, fgEnabled: false, fgWeight: 30 },
].map(ind => ({
  ...ind,
  includeOther: ind.includeOther || false,
  isPublic: true,
  creator: 'PMSI Team',
  createdAt: '2026-04-08T20:21:53Z',
  _isOwned: false,
  _isDefault: true,
}));

function addDefaultPublicIndicators(results) {
  const existingIds = new Set(results.map(i => i.id));
  for (const ind of DEFAULT_PUBLIC_INDICATORS) {
    if (!existingIds.has(ind.id)) {
      results.push({ ...ind, weights: { ...ind.weights } });
      existingIds.add(ind.id);
    }
  }
}

async function getIndicators() {
  if (_indicatorCache) return _indicatorCache;
  const results = [];
  let publicCount = 0;
  // Fetch user's own indicators if authenticated
  if (authState.token) {
    try {
      const res = await fetch('/api/indicators', { headers: authHeaders() });
      if (res.ok) {
        const items = await res.json();
        results.push(...items.map(i => ({ ...i, _isOwned: true })));
      }
    } catch (e) { console.error('Failed to fetch user indicators:', e); }
  }
  // Also fetch public indicators
  try {
    const res = await fetch('/api/indicators/public');
    if (res.ok) {
      const data = await res.json();
      const existingIds = new Set(results.map(i => i.id));
      for (const ind of (data.indicators || [])) {
        if (!existingIds.has(ind.id)) {
          results.push({ ...ind, _isOwned: false });
          publicCount++;
        }
      }
    }
  } catch (e) { console.error('Failed to fetch public indicators:', e); }
  if (publicCount === 0) addDefaultPublicIndicators(results);
  // Merge with localStorage
  const local = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  const allIds = new Set(results.map(i => i.id));
  for (const ind of local) {
    if (!allIds.has(ind.id)) results.push({ ...ind, _isOwned: true });
  }
  if (results.length > 0) _indicatorCache = results;
  return results;
}

// Sync version for non-async callers (builder load menu, edit, etc.)
function getIndicatorsSync() {
  if (_indicatorCache) return _indicatorCache;
  const results = [];
  addDefaultPublicIndicators(results);
  const local = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  const ids = new Set(results.map(i => i.id));
  for (const ind of local) {
    if (!ids.has(ind.id)) results.push({ ...ind, _isOwned: true });
  }
  return results;
}

async function saveIndicatorToStorage(indicator) {
  _indicatorCache = null;
  if (authState.token) {
    try {
      const isNew = !indicator._fromServer;
      const method = isNew ? 'POST' : 'PUT';
      const url = isNew ? '/api/indicators' : '/api/indicators/' + indicator.id;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(indicator),
      });
      if (res.ok) return;
    } catch (e) { console.error('Failed to save indicator:', e); }
  }
  // Fallback to localStorage
  const indicators = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  const idx = indicators.findIndex(ind => ind.id === indicator.id);
  if (idx >= 0) indicators[idx] = indicator;
  else indicators.push(indicator);
  localStorage.setItem('pcsi_indicators', JSON.stringify(indicators));
}

async function deleteIndicator(id) {
  _indicatorCache = null;
  if (authState.token) {
    try {
      await fetch('/api/indicators/' + id, { method: 'DELETE', headers: authHeaders() });
      return;
    } catch (e) { console.error('Failed to delete indicator:', e); }
  }
  const indicators = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]').filter(ind => ind.id !== id);
  localStorage.setItem('pcsi_indicators', JSON.stringify(indicators));
}

function generateId() {
  return Math.random().toString(36).substr(2, 8);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function indicatorBundlePrices(ind = {}) {
  const prices = ind.bundlePrices || {};
  return [10, 50, 100, 500].map(tier => Number(prices[tier] || 0));
}

function isPaidIndicator(ind = {}) {
  return !!ind.protected || !!ind.isPaid || indicatorBundlePrices(ind).some(price => Number.isFinite(price) && price > 0);
}

function isRecipeProtected(ind = {}) {
  return isPaidIndicator(ind) && !ind._isOwned;
}

function canComputeIndicator(ind = {}) {
  return !!(ind.markets || ind.weights);
}

function canForkIndicator(ind = {}) {
  return !isPaidIndicator(ind) && ind.forkable !== false && canComputeIndicator(ind);
}

function getIndicatorScore(ind = {}) {
  if (isRecipeProtected(ind)) return null;
  const raw = ind.score ?? ind.latestScore ?? ind.latest_score;
  const score = raw == null ? null : Number(raw);
  return Number.isFinite(score) ? score : null;
}

function getIndicatorMarketCount(ind = {}) {
  if (Number.isFinite(Number(ind.marketCount))) return Number(ind.marketCount);
  if (ind.markets && typeof ind.markets === 'object') return Object.keys(ind.markets).length;
  return Object.entries(ind.weights || {})
    .filter(([key, value]) => !['referenceAsset', 'markets'].includes(key) && Number(value) > 0)
    .length;
}

function indicatorProtectionBadge(ind = {}) {
  return isPaidIndicator(ind)
    ? '<span class="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">Protected</span>'
    : '';
}

function titleCaseAsset(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Mixed assets';
  if (raw.length <= 5 && raw === raw.toUpperCase()) return raw;
  return raw
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function referenceAssetLabel(key) {
  if (!key) return 'No benchmark';
  const meta = typeof ALL_REFERENCE_ASSETS !== 'undefined'
    ? ALL_REFERENCE_ASSETS.find(a => a.key === key || a.id === key)
    : null;
  return meta?.label || titleCaseAsset(key);
}

function referenceAssetFormat(key) {
  const meta = typeof ALL_REFERENCE_ASSETS !== 'undefined'
    ? ALL_REFERENCE_ASSETS.find(a => a.key === key || a.id === key)
    : null;
  return meta?.format || '$';
}

const UNDERLYING_ASSET_REFERENCE_KEYS = {
  BTC: 'btc_price',
  ETH: 'eth_price',
  SOL: 'sol_price',
  SPX: 'spx_price',
  NDX: 'ndx_price',
  DJI: 'dji_price',
  RUT: 'rut_price',
  MARKET: 'spx_price',
  VIX: 'vix_price',
  YIELD: 'us10y_yield',
  RATES: 'fed_rate',
  JOBS: 'unemployment',
  DXY: 'dxy_price',
  GOLD: 'gold_price',
  OIL: 'oil_price',
};

function underlyingAssetReferenceKey(asset) {
  return UNDERLYING_ASSET_REFERENCE_KEYS[String(asset || '').toUpperCase()] || null;
}

function indicatorAssetMix(ind = {}) {
  const counts = {};
  const protectedCount = getIndicatorMarketCount(ind);
  if (isRecipeProtected(ind)) {
    if (ind.asset) counts[ind.asset] = protectedCount || 1;
    return counts;
  }
  const markets = ind.markets || ind.weights?.markets;
  if (markets && typeof markets === 'object') {
    const marketIndex = getMarketHistoryIndex();
    for (const [mid, raw] of Object.entries(markets)) {
      const cfgAsset = raw && typeof raw === 'object' ? raw.asset : null;
      const asset = cfgAsset || marketIndex[mid]?.asset || ind.asset || 'Mixed';
      counts[asset] = (counts[asset] || 0) + 1;
    }
  } else if (ind.asset) {
    counts[ind.asset] = 1;
  }
  return counts;
}

function indicatorTrackingMeta(ind = {}) {
  const sectorId = ind.sector || 'crypto';
  const sectorLabel = SECTORS[sectorId]?.label || titleCaseAsset(sectorId);
  const refKey = resolveIndicatorReferenceAsset(ind, sectorId);
  const referenceLabel = referenceAssetLabel(refKey);
  const assetEntries = Object.entries(indicatorAssetMix(ind)).sort((a, b) => b[1] - a[1]);
  const total = assetEntries.reduce((sum, [, n]) => sum + n, 0);
  const primaryAsset = assetEntries[0]?.[0] || ind.asset || 'Mixed';
  const primaryCount = assetEntries[0]?.[1] || 0;
  const extraAssets = Math.max(0, assetEntries.length - 1);
  const assetLabel = extraAssets > 0
    ? `${titleCaseAsset(primaryAsset)} +${extraAssets}`
    : titleCaseAsset(primaryAsset);
  const assetDetail = extraAssets > 0
    ? `${primaryCount}/${total} ${titleCaseAsset(primaryAsset)} markets`
    : `${sectorLabel} focus`;
  const marketCount = getIndicatorMarketCount(ind);
  const modeLabel = ind.markets || ind.weights?.markets || ind.previewMarkets
    ? 'Market basket'
    : 'Category model';
  const benchmarkText = refKey ? `vs ${referenceLabel}` : 'no price benchmark';
  return {
    sectorId,
    sectorLabel,
    primaryAsset,
    assetLabel,
    assetDetail,
    referenceLabel,
    benchmarkText,
    modeLabel,
    marketCount,
    sentence: `Tracks ${assetLabel} ${sectorLabel.toLowerCase()} sentiment, ${benchmarkText}.`,
  };
}

function protectedForkMessage() {
  alert('This is a paid protected indicator. Its recipe cannot be forked or copied.');
}

function shortWalletLabel(wallet) {
  if (!wallet) return null;
  const w = String(wallet);
  return w.length > 12 ? `${w.slice(0, 4)}..${w.slice(-4)}` : w;
}

function currentCommentAuthorLabel() {
  if (authState.user?.wallet) return shortWalletLabel(authState.user.wallet);
  if (authState.token) return 'Account';
  return 'Guest';
}

let _marketHistoryIndexCache = null;

function invalidateMarketHistoryIndex() {
  _marketHistoryIndexCache = null;
}

function getSectorDefaultReferenceAsset(sectorId) {
  const sector = typeof SECTORS !== 'undefined' ? SECTORS[sectorId] : null;
  if (sector?.referenceData && Object.prototype.hasOwnProperty.call(sector.referenceData, 'priceKey')) {
    return sector.referenceData.priceKey;
  }
  return 'btc_price';
}

function resolveIndicatorReferenceAsset(config, sectorId) {
  if (Object.prototype.hasOwnProperty.call(config || {}, 'referenceAsset')) return config.referenceAsset;
  return getSectorDefaultReferenceAsset(sectorId || config?.sector || 'crypto');
}

function getMarketHistoryIndex() {
  if (_marketHistoryIndexCache) return _marketHistoryIndexCache;

  const index = {};
  for (const sId of SECTOR_ORDER) {
    const ssd = sectorDataCache[sId];
    if (!ssd?.sandbox?.assets) continue;
    for (const [asset, ad] of Object.entries(ssd.sandbox.assets)) {
      const dates = ad.dates || [];
      for (const [mid, m] of Object.entries(ad.markets || {})) {
        const ssMap = {}, wtMap = {}, activeDates = [];
        for (let i = 0; i < dates.length; i++) {
          ssMap[dates[i]] = m.ss?.[i];
          wtMap[dates[i]] = m.wt?.[i];
          if (m.ss?.[i] != null || m.wt?.[i] != null) activeDates.push(dates[i]);
        }
        const entry = {
          ssMap,
          wtMap,
          dates: activeDates,
          cat: m.cat,
          q: m.q,
          prob: m.prob,
          vol: m.vol,
          end: m.end,
          sector: sId,
          asset,
        };
        index[`${sId}:${mid}`] = entry;
        if (!index[mid]) index[mid] = entry;
      }
    }
  }

  _marketHistoryIndexCache = index;
  return _marketHistoryIndexCache;
}


// ── Core Computation ─────────────────────────────────────────────────────

function computeIndicatorTimeseries(config, sectorData) {
  const sectorId = config.sector || 'crypto';
  const sector = SECTORS[sectorId];
  const priceKey = resolveIndicatorReferenceAsset(config, sectorId);
  const fgKey = 'fear_greed';
  // Get refMap from the appropriate sector cache
  const refAssetMeta = typeof ALL_REFERENCE_ASSETS !== 'undefined' ? ALL_REFERENCE_ASSETS.find(a => a.key === priceKey) : null;
  const refSectorId = refAssetMeta?.sector || 'crypto';
  const refMap = sectorDataCache[refSectorId]?.refMap || sectorData?.refMap || {};

  const isMarketMode = !!config.markets && Object.keys(config.markets).length > 0;

  if (isMarketMode) {
    // Reuse a cross-sector per-market index so indicator lists do not rescan all data per card.
    const marketIndex = getMarketHistoryIndex();
    const marketLookups = {};
    const allDatesSet = new Set();

    for (const mid of Object.keys(config.markets)) {
      const rawCfg = config.markets[mid];
      const scopedSector = rawCfg && typeof rawCfg === 'object' && rawCfg.sector ? rawCfg.sector : sectorId;
      const lookup = marketIndex[`${scopedSector}:${mid}`] || marketIndex[mid];
      if (!lookup) continue;
      marketLookups[mid] = lookup;
      for (const d of lookup.dates) allDatesSet.add(d);
    }

    const dates = [...allDatesSet].sort();
    const scores = [], prices = [], fgValues = [];

    for (const d of dates) {
      let num = 0, den = 0;
      for (const [mid, rawW] of Object.entries(config.markets)) {
        const ml = marketLookups[mid];
        if (!ml) continue;
        const ss = ml.ssMap[d], wt = ml.wtMap[d];
        if (ss == null || wt == null) continue;
        const userW = getMarketWeight(rawW) / 100;
        const sign = isMarketFlipped(rawW) ? -1 : 1;
        num += userW * sign * ss * wt;
        den += userW * wt;
      }

      let score = den > 0 ? ((num / den) + 1) * 50 : null;
      const ref = refMap[d] || {};
      const fg = ref[fgKey] ?? null;
      if (score != null && config.fgEnabled && fg != null) {
        const blend = (config.fgWeight || 30) / 100;
        score = score * (1 - blend) + fg * blend;
      }

      scores.push(score);
      prices.push(priceKey ? (ref[priceKey] ?? null) : null);
      fgValues.push(fg);
    }
    return { dates, scores, prices, fgValues };
  }

  // Legacy category-mode fallback
  const data = sectorData?.sandbox;
  const assetData = data?.assets?.[config.asset];
  if (!assetData || !sector) return { dates: [], scores: [], prices: [], fgValues: [] };

  const dates = assetData.dates;
  const legacyRefMap = sectorData?.refMap || refMap;
  const scores = [], prices = [], fgValues = [];

  for (let i = 0; i < dates.length; i++) {
    let num = 0, den = 0;
    const catKeys = Object.keys(sector.categories).filter(c => c !== 'other');
    if (config.includeOther && sector.categories.other) catKeys.push('other');
    for (const cat of catKeys) {
      const w = (config.weights[cat] || 0) / 100;
      const cd = assetData.cats[cat];
      if (!cd || w === 0) continue;
      num += w * cd.ws[i];
      den += w * cd.wt[i];
    }

    let score = den > 0 ? ((num / den) + 1) * 50 : null;
    const ref = legacyRefMap[dates[i]] || {};
    const fg = ref[fgKey] ?? null;
    if (score != null && config.fgEnabled && fg != null) {
      const blend = (config.fgWeight || 30) / 100;
      score = score * (1 - blend) + fg * blend;
    }

    scores.push(score);
    prices.push(priceKey ? (ref[priceKey] ?? null) : null);
    fgValues.push(fg);
  }

  return { dates, scores, prices, fgValues };
}

// Handle normalized market weights for cross-sector indicators
function getMarketWeight(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val !== null) return val.w ?? val.weight ?? 100;
  return 100;
}
function isMarketFlipped(val) {
  if (typeof val === 'object' && val !== null) return !!val.flip;
  return false;
}

function computeBuilderTimeseries() {
  const sd = builderState;
  const selectedMarkets = sd.selectedMarkets || {};
  if (Object.keys(selectedMarkets).length === 0) {
    return { dates: [], scores: [], prices: [], fgValues: [], catScores: {} };
  }

  // Reference asset for price overlay
  const refAssetKey = sd.referenceAsset;
  const refAssetMeta = ALL_REFERENCE_ASSETS?.find(a => a.key === refAssetKey);
  const refSectorId = refAssetMeta?.sector || 'crypto';
  const refMap = sectorDataCache[refSectorId]?.refMap || sectorDataCache['crypto']?.refMap || {};

  const fgKey = 'fear_greed';

  // Build per-market lookup tables across all loaded data
  const marketIndex = getMarketHistoryIndex();
  const marketLookups = {};
  const allDatesSet = new Set();

  for (const [mid, cfg] of Object.entries(selectedMarkets)) {
    const scopedSector = cfg && typeof cfg === 'object' && cfg.sector ? cfg.sector : (sd.targetSector === 'all' ? null : sd.targetSector);
    const lookup = (scopedSector ? marketIndex[`${scopedSector}:${mid}`] : null) || marketIndex[mid];
    if (!lookup) continue;
    marketLookups[mid] = lookup;
    for (const d of lookup.dates) allDatesSet.add(d);
  }

  const dates = [...allDatesSet].sort();
  const scores = [], prices = [], fgValues = [], catScores = {};

  const activeCats = new Set();
  for (const mid of Object.keys(selectedMarkets)) {
    if (marketLookups[mid]) activeCats.add(marketLookups[mid].cat);
  }
  for (const c of activeCats) {
    if (c !== 'other') catScores[c] = [];
  }

  for (const d of dates) {
    let num = 0, den = 0;
    for (const [mid, cfg] of Object.entries(selectedMarkets)) {
      const ml = marketLookups[mid];
      if (!ml) continue;
      const ss = ml.ssMap[d], wt = ml.wtMap[d];
      if (ss == null || wt == null) continue;
      const userW = getMarketWeight(cfg) / 100;
      const sign = isMarketFlipped(cfg) ? -1 : 1;
      num += userW * sign * ss * wt;
      den += userW * wt;
    }

    let score = den > 0 ? ((num / den) + 1) * 50 : null;
    const ref = refMap[d] || {};
    const fg = ref[fgKey] ?? null;
    if (score != null && sd.fgEnabled && fg != null) {
      const blend = sd.fgWeight / 100;
      score = score * (1 - blend) + fg * blend;
    }

    scores.push(score);
    prices.push(refAssetKey ? (ref[refAssetKey] ?? null) : null);
    fgValues.push(fg);

    for (const cat of Object.keys(catScores)) {
      let cNum = 0, cDen = 0;
      for (const [mid, cfg] of Object.entries(selectedMarkets)) {
        const ml = marketLookups[mid];
        if (!ml || ml.cat !== cat) continue;
        const ss = ml.ssMap[d], wt = ml.wtMap[d];
        if (ss == null || wt == null) continue;
        const userW = getMarketWeight(cfg) / 100;
        const sign = isMarketFlipped(cfg) ? -1 : 1;
        cNum += userW * sign * ss * wt;
        cDen += userW * wt;
      }
      catScores[cat].push(cDen > 0 ? ((cNum / cDen) + 1) * 50 : null);
    }
  }

  return { dates, scores, prices, fgValues, catScores };
}

// ── Statistics ──────────────────────────────────────────────────────────────

function computeCorrelation(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] != null && ys[i] != null) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 5) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

// Signed information coefficient at a fixed lag — kept in step with
// api/_lib/compute.js. The old version scanned 8 lags, kept the max, and clamped
// negatives to zero, so it could never report "no power" or "inverted" and noise
// scored positive by construction.
const PREDICTIVE_LAGS = [1, 2, 3, 5, 7, 14, 21, 30];
const PREDICTIVE_PRIMARY_LAG = 7;
const PREDICTIVE_MIN_PAIRS = 20;

function pearsonCorr(pairs) {
  const n = pairs.length;
  if (n < 3) return 0;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : 0;
}

function computePredictiveScore(scores, prices) {
  const byLag = [];
  for (const lag of PREDICTIVE_LAGS) {
    const pairs = [];
    // Score CHANGE vs forward return: levels are autocorrelated, which inflates r.
    for (let i = 1; i < scores.length - lag; i++) {
      const s0 = scores[i], sPrev = scores[i - 1];
      const p0 = prices[i], pF = prices[i + lag];
      if (s0 == null || sPrev == null || p0 == null || pF == null || p0 <= 0) continue;
      pairs.push([s0 - sPrev, pF / p0 - 1]);
    }
    if (pairs.length < PREDICTIVE_MIN_PAIRS) continue;
    const ic = pearsonCorr(pairs);
    const nEff = Math.max(3, Math.floor(pairs.length / lag));  // overlapping windows
    const tStat = ic * Math.sqrt((nEff - 2) / Math.max(1e-9, 1 - ic * ic));
    byLag.push({
      lag,
      ic: Math.round(ic * 1000) / 1000,
      n: pairs.length,
      nEff,
      tStat: Math.round(tStat * 100) / 100,
      significant: Math.abs(tStat) >= 2,
    });
  }
  if (byLag.length === 0) return null;

  const primary = byLag.find(l => l.lag === PREDICTIVE_PRIMARY_LAG) || byLag[0];
  const inSampleBest = byLag.reduce((a, b) => (Math.abs(b.ic) > Math.abs(a.ic) ? b : a));

  return {
    score: Math.round(primary.ic * 100),   // signed, -100..100
    ic: primary.ic,
    n: primary.n,
    nEff: primary.nEff,
    tStat: primary.tStat,
    significant: primary.significant,
    lag: primary.lag,
    byLag,
    inSampleBest: { lag: inSampleBest.lag, ic: inSampleBest.ic, inSample: true },
    peakCorrelation: primary.ic,
    optimalLag: primary.lag,
  };
}

// Presentation for the signed IC. A statistically insignificant result reads
// "n.s." rather than borrowing the colour of a real one — an indicator with no
// measurable power should look like it has none.
function predictiveLabel(predictive) {
  if (!predictive) return '--';
  if (!predictive.significant) return `${predictive.score} n.s.`;
  return predictive.score > 0 ? `+${predictive.score}` : `${predictive.score}`;
}

function predictiveColor(predictive, dim) {
  if (!predictive || !predictive.significant) return dim || '#6b7280';
  if (predictive.score >= 10) return '#4ade80';
  if (predictive.score <= -10) return '#f87171';
  return '#fbbf24';
}

function computeDirectionalAccuracy(scores, prices) {
  let correct = 0, total = 0;
  for (let i = 0; i < scores.length - 1; i++) {
    if (scores[i] == null || prices[i] == null || prices[i + 1] == null) continue;
    const priceUp = prices[i + 1] > prices[i];
    const bullish = scores[i] > 50;
    if ((priceUp && bullish) || (!priceUp && !bullish)) correct++;
    total++;
  }
  return total > 0 ? (correct / total) * 100 : null;
}

function computePeriodDeltas(scores, dates) {
  const periods = { '1D': 1, '1W': 7, '1M': 30, '3M': 90 };
  const result = {};

  let lastIdx = scores.length - 1;
  while (lastIdx >= 0 && scores[lastIdx] == null) lastIdx--;
  if (lastIdx < 0) return { '1D': null, '1W': null, '1M': null, '3M': null };

  const lastScore = scores[lastIdx];
  const lastDate = new Date(dates[lastIdx] + 'T00:00:00');

  for (const [label, days] of Object.entries(periods)) {
    const targetDate = new Date(lastDate);
    targetDate.setDate(targetDate.getDate() - days);

    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i <= lastIdx; i++) {
      if (scores[i] == null) continue;
      const d = new Date(dates[i] + 'T00:00:00');
      const diff = Math.abs(d - targetDate);
      if (d <= targetDate && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    result[label] = bestIdx >= 0 ? lastScore - scores[bestIdx] : null;
  }

  return result;
}

// ── Sparkline Renderer ──────────────────────────────────────────────────────

function renderSparkline(canvas, indicatorScores, priceScores) {
  const ctx = canvas.getContext('2d');
  const n = Math.min(90, indicatorScores.length);
  const data = indicatorScores.slice(-n);
  const priceData = priceScores ? priceScores.slice(-n) : null;

  const datasets = [
    {
      data: data,
      borderColor: '#60a5fa',
      borderWidth: 1.5,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      yAxisID: 'y',
    },
  ];

  if (priceData && priceData.some(p => p != null)) {
    datasets.push({
      data: priceData,
      borderColor: 'rgba(156,163,175,0.4)',
      borderWidth: 1,
      borderDash: [2, 2],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      yAxisID: 'y2',
    });
  }

  return new Chart(ctx, {
    type: 'line',
    data: { labels: data.map((_, i) => i), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 100 },
        y2: { display: false },
      },
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE 1: INDICATORS (Unified flat list across all sectors)
// ═════════════════════════════════════════════════════════════════════════════

let indicatorViewMode = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches) ? 'card' : 'table';
let indicatorFilters = { query: '', sector: 'all', access: 'all' };
let indicatorLiveTimer = null;
let indicatorLiveSignature = '';
let indicatorLastCheckedAt = null;

function syncIndicatorViewButtons() {
  const tBtn = document.getElementById('ind-view-table');
  const cBtn = document.getElementById('ind-view-card');
  tBtn?.classList.toggle('active', indicatorViewMode === 'table');
  cBtn?.classList.toggle('active', indicatorViewMode === 'card');
}

function syncIndicatorControls() {
  const search = document.getElementById('ind-search');
  const clear = document.getElementById('ind-clear-search');
  const access = document.getElementById('ind-access-filter');
  if (search && search.value !== indicatorFilters.query) search.value = indicatorFilters.query;
  clear?.classList.toggle('hidden', !indicatorFilters.query);
  if (access && access.value !== indicatorFilters.access) access.value = indicatorFilters.access;
  document.querySelectorAll('[data-ind-sector]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-ind-sector') === indicatorFilters.sector);
  });
}

function setIndicatorView(mode) {
  indicatorViewMode = mode;
  syncIndicatorViewButtons();
  renderIndicatorsPage();
}

function setIndicatorSearch(value) {
  indicatorFilters.query = String(value || '').trim();
  syncIndicatorControls();
  renderIndicatorsPage();
}

function setIndicatorSectorFilter(sector) {
  indicatorFilters.sector = sector || 'all';
  syncIndicatorControls();
  renderIndicatorsPage();
}

function setIndicatorAccessFilter(access) {
  indicatorFilters.access = access || 'all';
  syncIndicatorControls();
  renderIndicatorsPage();
}

function clearIndicatorFilters() {
  indicatorFilters = { query: '', sector: 'all', access: 'all' };
  syncIndicatorControls();
  renderIndicatorsPage();
}

function renderIndicatorLoading() {
  const rows = Array.from({ length: 7 }).map((_, i) => `
    <div class="grid grid-cols-[44px_58px_1fr_80px] items-center gap-4 px-5 py-4 border-t border-gray-700/20" style="animation-delay:${i * 45}ms">
      <div class="w-3.5 h-3.5 rounded bg-gray-700/60"></div>
      <div class="w-11 h-11 rounded-full bg-gray-800/80 border border-gray-700/40"></div>
      <div class="space-y-2 min-w-0">
        <div class="loading-line w-48 max-w-full"></div>
        <div class="loading-line w-32 max-w-[70%] opacity-70"></div>
      </div>
      <div class="hidden sm:block loading-line w-16 justify-self-end opacity-60"></div>
    </div>
  `).join('');
  return `
    <div class="app-surface rounded-xl overflow-hidden" aria-label="Loading signals">
      <div class="grid grid-cols-[44px_58px_1fr_80px] items-center gap-4 px-5 py-3 text-[11px] text-gray-600 uppercase tracking-wider">
        <span></span><span>Score</span><span>Signal</span><span class="hidden sm:block text-right">Stats</span>
      </div>
      ${rows}
    </div>`;
}

function indicatorSearchText(ind) {
  const sector = ind.sector || 'crypto';
  return [
    ind.name,
    ind.creator,
    ind.creatorName,
    ind.asset,
    sector,
    SECTORS[sector]?.label,
    isPaidIndicator(ind) ? 'protected paid api' : 'forkable open free',
    ind._isOwned ? 'mine owned saved' : '',
  ].map(v => String(v || '').toLowerCase()).join(' ');
}

function indicatorMatchesFilters(row) {
  const ind = row.ind;
  if (indicatorFilters.sector !== 'all' && (ind.sector || 'crypto') !== indicatorFilters.sector) return false;
  if (indicatorFilters.access === 'protected' && !isPaidIndicator(ind)) return false;
  if (indicatorFilters.access === 'open' && !canForkIndicator(ind)) return false;
  if (indicatorFilters.access === 'mine' && !ind._isOwned) return false;
  const q = indicatorFilters.query.toLowerCase();
  if (q && !indicatorSearchText(ind).includes(q)) return false;
  return true;
}

function compactNumber(n, digits = 0) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function engagementScore(ind = {}) {
  return Number(ind.viewCount || 0) + Number(ind.commentCount || 0) * 4 + Number(ind.forkCount || 0) * 3;
}

function formatLiveTime(date) {
  if (!date) return 'starting';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 8) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function renderInsight(label, value, detail, tone = 'blue', live = false) {
  const colors = {
    blue: 'text-blue-300',
    green: 'text-green-300',
    amber: 'text-amber-300',
    gray: 'text-gray-300',
  };
  return `
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap ${live ? 'live-inline' : ''}">
      ${live ? '<span class="alive-dot"></span>' : ''}
      <span class="text-gray-600">${label}</span>
      <span class="${colors[tone] || colors.blue} font-medium tabular-nums">${value}</span>
      <span class="hidden sm:inline text-gray-600">${detail}</span>
    </span>`;
}

function renderIndicatorInsights(rankedAll, ranked) {
  const el = document.getElementById('indicator-insights');
  if (!el) return;
  const withScores = rankedAll.filter(r => r.lastScore != null);
  const avgScore = withScores.length
    ? withScores.reduce((sum, r) => sum + r.lastScore, 0) / withScores.length
    : null;
  const protectedCount = rankedAll.filter(r => isPaidIndicator(r.ind)).length;
  const predictiveLeaders = rankedAll.filter(r => r.predictive?.significant && r.predictive.score > 0).length;
  const totalEngagement = rankedAll.reduce((sum, r) => sum + engagementScore(r.ind), 0);
  const top = [...rankedAll].filter(r => r.lastScore != null).sort((a, b) => b.lastScore - a.lastScore)[0];
  el.innerHTML = [
    renderInsight('Visible', compactNumber(ranked.length), `${rankedAll.length} total signals`, 'blue'),
    renderInsight('Avg score', avgScore == null ? '--' : avgScore.toFixed(1), `${withScores.length} scored signals`, avgScore != null && avgScore >= 60 ? 'green' : 'gray'),
    renderInsight('Protected', compactNumber(protectedCount), 'paid API signals', protectedCount > 0 ? 'amber' : 'gray'),
    renderInsight('Live pulse', compactNumber(totalEngagement), `checked ${formatLiveTime(indicatorLastCheckedAt)}`, totalEngagement > 0 ? 'green' : 'gray', true),
  ].join('');
}

function renderIndicatorActivity(rankedAll) {
  const el = document.getElementById('indicator-activity');
  if (!el) return;
  const active = [...rankedAll]
    .filter(r => engagementScore(r.ind) > 0 || r.ind.publishedAt || r.ind.createdAt)
    .sort((a, b) => {
      const engagementDelta = engagementScore(b.ind) - engagementScore(a.ind);
      if (engagementDelta !== 0) return engagementDelta;
      return String(b.ind.publishedAt || b.ind.createdAt || '').localeCompare(String(a.ind.publishedAt || a.ind.createdAt || ''));
    })
    .slice(0, 5);

  if (!active.length) {
    el.innerHTML = `
      <div class="activity-rail">
        <div class="activity-item"><span class="alive-dot"></span><span>Watching for new views, comments, forks, and published signals</span></div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="activity-rail flex items-center overflow-x-auto">
      <div class="activity-item text-green-300"><span class="alive-dot"></span><span>Live activity</span></div>
      ${active.map(({ ind }) => {
        const pieces = [];
        if (Number(ind.viewCount || 0) > 0) pieces.push(`${compactNumber(ind.viewCount)} views`);
        if (Number(ind.commentCount || 0) > 0) pieces.push(`${compactNumber(ind.commentCount)} comments`);
        if (Number(ind.forkCount || 0) > 0) pieces.push(`${compactNumber(ind.forkCount)} forks`);
        if (isPaidIndicator(ind)) pieces.push('protected preview');
        return `<button type="button" onclick="location.hash='#indicator?id=${ind.id}'" class="activity-item hover:text-gray-200 transition-colors">
          <span class="max-w-[160px] truncate text-gray-300">${escapeHtml(ind.name || 'Untitled')}</span>
          <span class="text-gray-600">${escapeHtml(pieces.slice(0, 2).join(' · ') || 'newly listed')}</span>
        </button>`;
      }).join('')}
    </div>`;
}

function renderIndicatorSectorTabs(rankedAll) {
  const el = document.getElementById('ind-sector-tabs');
  if (!el) return;
  const counts = rankedAll.reduce((acc, row) => {
    const sector = row.ind.sector || 'crypto';
    acc[sector] = (acc[sector] || 0) + 1;
    return acc;
  }, {});
  const sectors = ['all', ...SECTOR_ORDER.filter(s => counts[s] > 0)];
  el.innerHTML = sectors.map(sector => {
    const label = sector === 'all' ? 'All' : (SECTORS[sector]?.label || sector);
    const count = sector === 'all' ? rankedAll.length : counts[sector];
    return `<button type="button" data-ind-sector="${sector}" onclick="setIndicatorSectorFilter('${sector}')" class="ind-filter-chip ${indicatorFilters.sector === sector ? 'active' : ''}">
      <span>${label}</span><span class="text-[10px] text-gray-600 tabular-nums">${count || 0}</span>
    </button>`;
  }).join('');
}

function indicatorEngagementSignature(items = []) {
  return items
    .map(row => {
      const ind = row.ind || row;
      return [ind.id, ind.viewCount || 0, ind.commentCount || 0, ind.forkCount || 0].join(':');
    })
    .sort()
    .join('|');
}

function startIndicatorLiveUpdates(rankedAll = []) {
  indicatorLastCheckedAt = new Date();
  const publicRows = rankedAll.filter(row => !row.ind?._isOwned || row.ind?.isPublic !== false);
  indicatorLiveSignature = indicatorEngagementSignature(publicRows);
  if (indicatorLiveTimer) return;
  indicatorLiveTimer = setInterval(async () => {
    if ((location.hash || '#indicators').split('?')[0] !== '#indicators') return;
    try {
      const res = await fetch('/api/indicators/public?limit=100&sort=newest', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const nextSignature = indicatorEngagementSignature(data.indicators || []);
      indicatorLastCheckedAt = new Date();
      if (nextSignature && nextSignature !== indicatorLiveSignature) {
        indicatorLiveSignature = nextSignature;
        _indicatorCache = null;
        renderIndicatorsPage();
      } else {
        const ranked = (_indicatorCache || []).map(ind => ({ ind }));
        renderIndicatorActivity(ranked);
        const liveDetail = document.querySelector('#indicator-insights .live-inline .hidden');
        if (liveDetail) liveDetail.textContent = `checked ${formatLiveTime(indicatorLastCheckedAt)}`;
      }
    } catch (_) {}
  }, 45000);
}

async function renderIndicatorsPage() {
  const container = document.getElementById('indicators-sectors');
  if (!container) return;
  syncIndicatorViewButtons();
  syncIndicatorControls();
  if (!container.dataset.ready) {
    container.setAttribute('aria-busy', 'true');
    container.innerHTML = renderIndicatorLoading();
  }

  // Destroy old sparklines
  sparklineCharts.forEach(c => c.destroy());
  sparklineCharts = [];

  const indicators = await getIndicators();

  // Load data for all sectors that have indicators
  const allSectors = new Set(indicators.map(i => i.sector || 'crypto'));
  const loadPromises = [...allSectors].filter(s => SECTORS[s]?.available).map(s => loadSectorData(s));
  await Promise.all(loadPromises);

  // Compute stats for each indicator
  const rankedAll = indicators.map(ind => {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    if (sectorData && canComputeIndicator(ind)) {
      const ts = computeIndicatorTimeseries(ind, sectorData);
      const corr = computeCorrelation(ts.scores, ts.prices);
      const dirAcc = computeDirectionalAccuracy(ts.scores, ts.prices);
      const predictive = computePredictiveScore(ts.scores, ts.prices);
      const deltas = computePeriodDeltas(ts.scores, ts.dates);
      const lastScore = [...ts.scores].reverse().find(s => s != null);
      return { ind, ts, corr, dirAcc, predictive, deltas, lastScore };
    }
    return { ind, ts: { dates: [], scores: [], prices: [] }, corr: null, dirAcc: null, predictive: null, deltas: {}, lastScore: getIndicatorScore(ind) };
  });
  const ranked = rankedAll.filter(indicatorMatchesFilters);

  // Sort
  const sortBy = document.getElementById('ind-sort')?.value || 'score';
  ranked.sort((a, b) => {
    switch (sortBy) {
      case 'score':
        return (b.lastScore ?? -1) - (a.lastScore ?? -1);
      case 'correlation': {
        const ca = a.corr != null ? Math.abs(a.corr) : -1;
        const cb = b.corr != null ? Math.abs(b.corr) : -1;
        return cb - ca;
      }
      case 'predictive': {
        const pa = a.predictive?.significant ? a.predictive.score : -Infinity;
        const pb = b.predictive?.significant ? b.predictive.score : -Infinity;
        return pb - pa;
      }
      case 'newest':
        return (b.ind.createdAt || '').localeCompare(a.ind.createdAt || '');
      case 'name':
        return (a.ind.name || '').localeCompare(b.ind.name || '');
      default:
        return 0;
    }
  });

  if (!indicatorLastCheckedAt) indicatorLastCheckedAt = new Date();
  renderIndicatorInsights(rankedAll, ranked);
  renderIndicatorActivity(rankedAll);
  renderIndicatorSectorTabs(rankedAll);
  startIndicatorLiveUpdates(rankedAll);
  syncIndicatorControls();

  // Update count
  const countEl = document.getElementById('ind-count');
  if (countEl) {
    countEl.textContent = ranked.length > 0
      ? `${ranked.length}/${rankedAll.length}`
      : `0/${rankedAll.length}`;
  }

  if (rankedAll.length === 0) {
    container.innerHTML = `
      <div class="app-surface rounded-xl p-12 border-dashed text-center">
        <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-800/60 flex items-center justify-center">
          <svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        </div>
        <div class="text-gray-300 font-medium mb-1">No signals yet</div>
        <p class="text-gray-500 text-sm mb-5">Create your first market signal to start tracking prediction markets.</p>
        <a href="#builder" class="inline-flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 active:scale-[0.97] transition-all shadow-lg shadow-blue-600/20">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Build Signal
        </a>
      </div>`;
    container.dataset.ready = 'true';
    container.removeAttribute('aria-busy');
    return;
  }

  if (ranked.length === 0) {
    container.innerHTML = `
      <div class="app-surface rounded-xl p-10 border-dashed text-center">
        <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-800/60 flex items-center justify-center">
          <svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M3 4a1 1 0 011-1h16a1 1 0 01.8 1.6l-6.3 8.4V19a1 1 0 01-1.45.89l-3-1.5A1 1 0 019.5 17.5V13L3.2 4.6A1 1 0 013 4z"/></svg>
        </div>
        <div class="text-gray-300 font-medium mb-1">No matches</div>
        <p class="text-gray-500 text-sm mb-5">Try a different sector, access type, or search term.</p>
        <button onclick="clearIndicatorFilters()" class="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-blue-200 bg-blue-500/10 border border-blue-500/25 rounded-lg hover:border-blue-400/50 transition-colors">Clear filters</button>
      </div>`;
    container.dataset.ready = 'true';
    container.removeAttribute('aria-busy');
    return;
  }

  if (indicatorViewMode === 'card') {
    container.innerHTML = renderIndicatorCards(ranked);
  } else {
    container.innerHTML = renderIndicatorTableUnified(ranked);
  }
  container.dataset.ready = 'true';
  container.removeAttribute('aria-busy');

  // Render sparklines after DOM update
  requestAnimationFrame(async () => {
    const indicators = await getIndicators();
    for (const ind of indicators) {
      const sectorData = sectorDataCache[ind.sector || 'crypto'];
      if (!sectorData || !canComputeIndicator(ind)) continue;
      const canvas = document.getElementById('spark-' + ind.id);
      if (canvas) {
        const ts = computeIndicatorTimeseries(ind, sectorData);
        const chart = renderSparkline(canvas, ts.scores, ts.prices);
        sparklineCharts.push(chart);
      }
    }
  });
}

function getIndicatorComponents(ind, catMeta) {
  if (isRecipeProtected(ind)) {
    const count = getIndicatorMarketCount(ind);
    return `<span style="color:#fbbf24">Protected recipe</span>${count ? ` <span style="color:#6b7280">${count} inputs</span>` : ''}`;
  }
  if (ind.markets) {
    const marketCount = Object.keys(ind.markets).length;
    const catCounts = {};
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    const mkts = sectorData?.sandbox?.assets?.[ind.asset]?.markets || {};
    for (const mid of Object.keys(ind.markets)) {
      const cat = mkts[mid]?.cat || 'other';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
    const pills = Object.entries(catCounts)
      .filter(([k]) => catMeta[k])
      .map(([k, n]) => `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:10px;background:${catMeta[k].accent}20;color:${catMeta[k].accent}">${catMeta[k].label} ${n}</span>`)
      .join(' ');
    return `<span style="color:#6b7280">${marketCount}m</span> ${pills}${ind.fgEnabled ? ' <span style="color:#22c55e;font-size:10px">F&G</span>' : ''}`;
  }
  const parts = Object.entries(ind.weights || {})
    .filter(([k, v]) => v > 0 && k !== 'other')
    .map(([k, v]) => `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:10px;background:${(catMeta[k]?.accent || '#6b7280')}20;color:${catMeta[k]?.accent || '#6b7280'}">${catMeta[k]?.label || k} ${v}%</span>`);
  return parts.join(' ');
}

function fmtDelta(d) {
  if (d == null) return '<span style="color:#4b5563">--</span>';
  const sign = d > 0 ? '+' : '';
  const color = d > 0 ? '#4ade80' : d < 0 ? '#f87171' : '#9ca3af';
  return `<span style="color:${color}">${sign}${d.toFixed(1)}</span>`;
}

function renderEngagementPills(ind = {}) {
  const views = Number(ind.viewCount || 0);
  const comments = Number(ind.commentCount || 0);
  const forks = Number(ind.forkCount || 0);
  const score = engagementScore(ind);
  const pills = [];
  if (views > 0) pills.push(`<span class="engagement-pill ${score >= 20 ? 'hot' : ''}" title="Views">${compactNumber(views)}</span>`);
  if (comments > 0) pills.push(`<span class="engagement-pill hot" title="Comments">${compactNumber(comments)} c</span>`);
  if (forks > 0) pills.push(`<span class="engagement-pill" title="Forks">${compactNumber(forks)} f</span>`);
  return pills.join('');
}

function scoreRingSvg(score, color, size = 44) {
  const fontSize = size <= 44 ? 13 : Math.round(size * 0.28);
  const stroke = size <= 44 ? 3 : 4;
  if (score == null) return `<div class="score-ring" style="width:${size}px;height:${size}px"><div class="score-ring-text"><span style="font-size:${fontSize}px" class="text-gray-600 tabular-nums">--</span></div></div>`;
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return `
    <div class="score-ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="${stroke}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}" stroke-linecap="round"
          style="transition:stroke-dashoffset 0.6s ease"/>
      </svg>
      <div class="score-ring-text"><span style="font-size:${fontSize}px;color:${color}" class="font-bold tabular-nums">${score.toFixed(1)}</span></div>
    </div>`;
}

function renderIndicatorTableUnified(ranked) {
  const svgAlert = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>';
  const svgEdit = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  const svgTrash = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
  const svgFork = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4h10v10H4zM10 10h10v10H10z"/></svg>';

  let html = `
    <div class="app-surface rounded-xl overflow-x-auto">
      <table class="ind-table text-xs">
        <thead>
          <tr class="text-[11px] text-gray-500 uppercase tracking-wider font-medium" style="background:rgba(255,255,255,0.015)">
            <th class="py-3 px-4 pl-5 w-7"></th>
            <th class="py-3 px-3 w-[52px] text-center">Score</th>
            <th class="py-3 px-3">Indicator</th>
            <th class="py-3 px-3 w-14 text-center hidden sm:table-cell">Corr</th>
            <th class="py-3 px-3 w-14 text-center hidden lg:table-cell">Dir Acc</th>
            <th class="py-3 px-3 w-14 text-center hidden lg:table-cell">Pred</th>
            <th class="py-3 px-3 w-12 text-center hidden sm:table-cell">7d</th>
            <th class="py-3 px-3 w-12 text-center hidden md:table-cell">30d</th>
            <th class="py-3 px-3 pr-5 w-20"></th>
          </tr>
        </thead>
        <tbody>`;

  ranked.forEach(({ ind, corr, dirAcc, predictive, deltas, lastScore }, idx) => {
    const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
    const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '--';
    const corrClr = corr != null ? (Math.abs(corr) > 0.5 ? '#4ade80' : Math.abs(corr) > 0.3 ? '#fbbf24' : '#9ca3af') : '#4b5563';
    const dirAccStr = dirAcc != null ? dirAcc.toFixed(0) + '%' : '--';
    const dirAccClr = dirAcc != null ? (dirAcc > 55 ? '#4ade80' : dirAcc > 50 ? '#fbbf24' : '#9ca3af') : '#4b5563';
    const predStr = predictiveLabel(predictive);
    const predClr = predictiveColor(predictive, '#4b5563');
    const escapedName = ind.name.replace(/'/g, "\\'");
    const marketCount = getIndicatorMarketCount(ind);
    const label = lastScore != null ? scoreLabel(lastScore) : '';
    const sectorTag = (ind.sector && ind.sector !== 'crypto') ? `<span class="sector-chip shrink-0">${SECTORS[ind.sector]?.label || ind.sector}</span>` : '';
    const protectionBadge = indicatorProtectionBadge(ind);
    const engagementPills = renderEngagementPills(ind);

    html += `
          <tr class="group ind-row-anim cursor-pointer" style="animation-delay:${idx * 40}ms" onclick="location.hash='#indicator?id=${ind.id}'">
            <td class="py-4 px-4 pl-5 align-middle" onclick="event.stopPropagation()">
              <input type="checkbox" data-compare-id="${ind.id}" onchange="toggleCompareIndicator('${ind.id}')"
                class="w-3.5 h-3.5 rounded cursor-pointer opacity-40 group-hover:opacity-100 transition-opacity" style="accent-color:#60a5fa">
            </td>
            <td class="py-4 px-3 align-middle">
              ${scoreRingSvg(lastScore, sColor)}
            </td>
            <td class="py-4 px-3 align-middle">
              <div class="flex items-center gap-3">
                <div class="hidden sm:block h-8 w-[80px] shrink-0"><canvas id="spark-${ind.id}"></canvas></div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-[13px] text-gray-100 font-medium leading-tight truncate">${ind.name}</span>
                    ${sectorTag}
                    ${protectionBadge}
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    ${!ind._isOwned && ind.creator ? `<span class="text-[10px] text-gray-500">by ${ind.creator}</span>` : ''}
                    ${marketCount > 0 ? `<span class="text-[10px] text-gray-500">${marketCount} markets</span>` : ''}
                    ${ind.fgEnabled ? '<span class="text-[10px] text-green-500/80">F&G</span>' : ''}
                    ${label ? `<span class="text-[10px] text-gray-600">${label}</span>` : ''}
                    ${engagementPills}
                  </div>
                </div>
              </div>
            </td>
            <td class="py-4 px-3 text-center align-middle tabular-nums hidden sm:table-cell" style="color:${corrClr}">
              <div class="text-[13px] font-medium">${corrStr}</div>
            </td>
            <td class="py-4 px-3 text-center align-middle tabular-nums hidden lg:table-cell" style="color:${dirAccClr}">
              <div class="text-[13px]">${dirAccStr}</div>
            </td>
            <td class="py-4 px-3 text-center align-middle tabular-nums hidden lg:table-cell" style="color:${predClr}">
              <div class="text-[13px]">${predStr}</div>
            </td>
            <td class="py-4 px-3 text-center align-middle tabular-nums hidden sm:table-cell">
              <div class="text-[12px]">${fmtDelta(deltas['1W'])}</div>
            </td>
            <td class="py-4 px-3 text-center align-middle tabular-nums hidden md:table-cell">
              <div class="text-[12px]">${fmtDelta(deltas['1M'])}</div>
            </td>
            <td class="py-4 px-3 pr-5 text-right align-middle" onclick="event.stopPropagation()">
              <span class="inline-flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200">
                <button onclick="openAlertModal('${ind.id}','${escapedName}')" class="ind-action text-gray-500 hover:text-blue-400" title="Set alert">${svgAlert}</button>
                ${ind._isOwned ? `
                <button onclick="editIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-blue-400" title="Edit">${svgEdit}</button>
                <button onclick="confirmDeleteIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-red-400" title="Delete">${svgTrash}</button>
                ` : `
                ${canForkIndicator(ind)
                  ? `<button onclick="forkIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-green-400" title="Fork">${svgFork}</button>`
                  : `<button onclick="protectedForkMessage()" class="ind-action text-gray-600 cursor-not-allowed" title="Protected recipe">${svgFork}</button>`}
                `}
              </span>
            </td>
          </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

function renderIndicatorCards(ranked) {
  const svgAlertSm = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>';
  const svgEditSm = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  const svgTrashSm = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
  const svgForkSm = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4h10v10H4zM10 10h10v10H10z"/></svg>';

  let html = '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">';
  ranked.forEach(({ ind, corr, dirAcc, predictive, deltas, lastScore }, idx) => {
    const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
    const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '--';
    const corrClr = corr != null ? (Math.abs(corr) > 0.5 ? '#4ade80' : Math.abs(corr) > 0.3 ? '#fbbf24' : '#9ca3af') : '#6b7280';
    const dirAccStr = dirAcc != null ? dirAcc.toFixed(0) + '%' : '--';
    const dirAccClr = dirAcc != null ? (dirAcc > 55 ? '#4ade80' : dirAcc > 50 ? '#fbbf24' : '#9ca3af') : '#6b7280';
    const predStr = predictiveLabel(predictive);
    const predClr = predictiveColor(predictive, '#6b7280');
    const marketCount = getIndicatorMarketCount(ind);
    const escapedName = ind.name.replace(/'/g, "\\'");
    const label = lastScore != null ? scoreLabel(lastScore) : '';
    const sectorTag = (ind.sector && ind.sector !== 'crypto') ? `<span class="sector-chip">${SECTORS[ind.sector]?.label || ind.sector}</span>` : '';
    const protectionBadge = indicatorProtectionBadge(ind);
    const engagementPills = renderEngagementPills(ind);

    html += `
      <div class="group ind-card-anim app-surface rounded-xl hover:border-gray-600/60 transition-all duration-200 hover:bg-gray-800/50 hover:shadow-lg hover:shadow-black/20 overflow-hidden flex flex-col cursor-pointer" style="animation-delay:${idx * 50}ms" onclick="location.hash='#indicator?id=${ind.id}'">
        <div class="p-5 pb-3 flex items-start gap-4">
          ${scoreRingSvg(lastScore, sColor)}
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold text-gray-100 truncate leading-tight">${ind.name}</div>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              ${!ind._isOwned && ind.creator ? `<span class="text-[10px] text-gray-500">by ${ind.creator}</span>` : ''}
              ${sectorTag}
              ${protectionBadge}
              ${marketCount > 0 ? `<span class="text-[10px] text-gray-500">${marketCount} market${marketCount !== 1 ? 's' : ''}</span>` : ''}
              ${ind.fgEnabled ? '<span class="text-[10px] text-green-500/80">F&G</span>' : ''}
              ${label ? `<span class="text-[10px] text-gray-600">${label}</span>` : ''}
              ${engagementPills}
            </div>
          </div>
          <div class="flex gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-200" onclick="event.stopPropagation()">
            <button onclick="openAlertModal('${ind.id}','${escapedName}')" class="ind-action text-gray-500 hover:text-blue-400" title="Set alert">${svgAlertSm}</button>
            ${ind._isOwned ? `
            <button onclick="editIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-blue-400" title="Edit">${svgEditSm}</button>
            <button onclick="confirmDeleteIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-red-400" title="Delete">${svgTrashSm}</button>
            ` : `
            ${canForkIndicator(ind)
              ? `<button onclick="forkIndicator('${ind.id}')" class="ind-action text-gray-500 hover:text-green-400" title="Fork">${svgForkSm}</button>`
              : `<button onclick="protectedForkMessage()" class="ind-action text-gray-600 cursor-not-allowed" title="Protected recipe">${svgForkSm}</button>`}
            `}
          </div>
        </div>

        <div class="px-5 h-12 mt-auto"><canvas id="spark-${ind.id}"></canvas></div>

        <div class="px-5 py-3 mt-2 border-t border-gray-700/20 bg-gray-900/20">
          <div class="flex items-center gap-2 flex-wrap tabular-nums">
            <span class="stat-pill" style="color:${corrClr}"><span class="text-gray-600 text-[10px]">r</span> ${corrStr}</span>
            <span class="stat-pill" style="color:${dirAccClr}"><span class="text-gray-600 text-[10px]">acc</span> ${dirAccStr}</span>
            <span class="stat-pill" style="color:${predClr}"><span class="text-gray-600 text-[10px]">pred</span> ${predStr}</span>
            <span class="stat-pill">${fmtDelta(deltas['1W'])}<span class="text-gray-600 text-[10px] ml-0.5">7d</span></span>
            <span class="stat-pill">${fmtDelta(deltas['1M'])}<span class="text-gray-600 text-[10px] ml-0.5">30d</span></span>
          </div>
        </div>
      </div>`;
  });
  html += '</div>';
  return html;
}

async function editIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (!ind) return;
  builderState.builderStarted = true;
  builderState.editingId = id;
  setBuilderTargetFromIndicator(ind);
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  builderState.referenceAsset = ind.referenceAsset ?? builderState.referenceAsset ?? null;
  builderState._pendingName = ind.name || '';
  location.hash = '#builder?id=' + id;
}

async function forkIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (!ind) {
    // Fetch directly if not in cache
    try {
      const res = await fetch('/api/indicators/' + id);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      if (!canForkIndicator(data)) { protectedForkMessage(); return; }
      forkFromData(data, id);
    } catch (err) { console.error('Fork failed:', err); }
    return;
  }
  if (!canForkIndicator(ind)) { protectedForkMessage(); return; }
  forkFromData(ind, id);
}

function forkFromData(ind, sourceId) {
  if (!canForkIndicator(ind)) { protectedForkMessage(); return; }
  builderState.editingId = null;
  builderState.builderStarted = true;
  setBuilderTargetFromIndicator(ind);
  builderState._pendingName = (ind.name || 'Indicator') + ' (fork)';
  builderState._pendingForkedFrom = sourceId;
  builderState._pendingForkSource = JSON.parse(JSON.stringify(ind));
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  builderState.referenceAsset = Object.prototype.hasOwnProperty.call(ind, 'referenceAsset')
    ? ind.referenceAsset
    : (SECTORS[ind.sector || 'crypto']?.referenceData?.priceKey ?? null);
  builderState.initialized = false;

  if (ind.markets) {
    builderState.selectedMarkets = typeof ind.markets === 'object'
      ? JSON.parse(JSON.stringify(ind.markets))
      : {};
  } else if (ind.weights) {
    copyIndicatorMarketsToBuilder(ind);
  }

  if ((location.hash || '').split('?')[0] === '#builder') {
    if (location.hash !== '#builder') history.replaceState(null, '', '#builder');
    renderBuilderPage();
  } else {
    location.hash = '#builder';
  }
}

async function confirmDeleteIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (ind && confirm(`Delete "${ind.name}"?`)) {
    await deleteIndicator(id);
    if (location.hash.startsWith('#indicator?')) {
      location.hash = '#indicators';
    } else {
      renderIndicatorsPage();
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE 1b: INDICATOR DETAIL
// ═════════════════════════════════════════════════════════════════════════════

let detailChartInstance = null;

function localEngagementKey(id) {
  return 'pmsi_indicator_engagement_' + id;
}

function getLocalIndicatorEngagement(id) {
  try {
    return JSON.parse(localStorage.getItem(localEngagementKey(id)) || '{"viewCount":0,"comments":[]}');
  } catch (_) {
    return { viewCount: 0, comments: [] };
  }
}

function saveLocalIndicatorEngagement(id, data) {
  localStorage.setItem(localEngagementKey(id), JSON.stringify({
    viewCount: data.viewCount || 0,
    comments: Array.isArray(data.comments) ? data.comments.slice(0, 50) : [],
  }));
}

async function recordIndicatorView(id, ind) {
  const viewedKey = 'pmsi_viewed_indicator_' + id;
  const alreadyViewed = sessionStorage.getItem(viewedKey);
  const local = getLocalIndicatorEngagement(id);
  let viewCount = ind.viewCount || local.viewCount || 0;
  if (alreadyViewed) return viewCount;

  sessionStorage.setItem(viewedKey, '1');
  try {
    const res = await fetch('/api/indicators/' + id + '/view', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      return data.viewCount ?? viewCount;
    }
  } catch (_) {}

  local.viewCount = Math.max(viewCount, local.viewCount || 0) + 1;
  saveLocalIndicatorEngagement(id, local);
  return local.viewCount;
}

async function loadIndicatorComments(id) {
  try {
    const res = await fetch('/api/indicators/' + id + '/comments');
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data.comments) ? data.comments : [];
    }
  } catch (_) {}
  return [];
}

function renderIndicatorComments(id, comments) {
  const el = document.getElementById('indicator-comments-list');
  const countEl = document.getElementById('indicator-comment-count');
  const totalEl = document.getElementById('indicator-comment-total');
  if (countEl) countEl.textContent = String(comments.length);
  if (totalEl) totalEl.textContent = String(comments.length);
  if (!el) return;
  if (!comments.length) {
    el.innerHTML = '<div class="text-sm text-gray-500 py-5">No comments yet.</div>';
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="py-3 border-b border-gray-800/50 last:border-0">
      <div class="flex items-center justify-between gap-3 mb-1">
        <span class="text-xs font-medium text-gray-300">${escapeHtml(c.authorName || 'Anonymous')}</span>
        <span class="text-[11px] text-gray-600">${c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
      </div>
      <p class="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">${escapeHtml(c.body || '')}</p>
    </div>
  `).join('');
}

async function submitIndicatorComment(id) {
  const bodyEl = document.getElementById('indicator-comment-body');
  const errEl = document.getElementById('indicator-comment-error');
  const body = bodyEl?.value.trim() || '';
  if (errEl) errEl.textContent = '';
  if (body.length < 2) {
    if (errEl) errEl.textContent = 'Write a little more before posting.';
    return;
  }
  if (body.length > 1000) {
    if (errEl) errEl.textContent = 'Comments are capped at 1000 characters.';
    return;
  }

  let comments = [];
  let errorMessage = 'Could not post this comment. Check your connection and try again.';
  try {
    const res = await fetch('/api/indicators/' + id + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const data = await res.json();
      comments = [data.comment, ...(await loadIndicatorComments(id)).filter(c => c.id !== data.comment.id)];
      if (bodyEl) bodyEl.value = '';
      renderIndicatorComments(id, comments);
      return;
    }
    try {
      const data = await res.json();
      errorMessage = data.error || errorMessage;
    } catch (_) {}
  } catch (_) {}

  if (errEl) errEl.textContent = errorMessage;
}

function indicatorActiveCategories(ind, marketIndex) {
  const cats = new Set();
  if (ind.markets) {
    for (const mid of Object.keys(ind.markets)) {
      const m = marketIndex[mid];
      if (m?.cat) cats.add(m.cat);
    }
  }
  for (const [cat, weight] of Object.entries(ind.weights || {})) {
    if (cat !== 'referenceAsset' && Number(weight) > 0) cats.add(cat);
  }
  return cats;
}

function getRelatedMarketSuggestions(ind, limit = 8) {
  const selected = new Set(Object.keys(ind.markets || {}));
  const marketIndex = getMarketHistoryIndex();
  const activeCats = indicatorActiveCategories(ind, marketIndex);
  const words = new Set(String(`${ind.name || ''} ${ind.asset || ''}`)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4));

  return _getAllMarkets()
    .filter(m => !selected.has(m.mid))
    .map(m => {
      let score = 0;
      const reasons = [];
      if (m._sId === (ind.sector || 'crypto')) { score += 4; reasons.push(SECTORS[m._sId]?.label || m._sId); }
      if (m._asset === ind.asset) { score += 3; reasons.push(m._asset); }
      if (activeCats.has(m.cat)) { score += 3; reasons.push((m.cat || '').replace(/_/g, ' ')); }
      const q = String(m.q || '').toLowerCase();
      for (const w of words) {
        if (q.includes(w)) score += 1;
      }
      score += Math.min(3, Math.log10((m.vol || 0) + 1));
      return { ...m, _score: score, _why: [...new Set(reasons)].slice(0, 3).join(' / ') };
    })
    .filter(m => m._score > 3)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

function getProtectedPreviewMarkets(ind, limit = 4) {
  const preview = Array.isArray(ind.previewMarkets) ? ind.previewMarkets : [];
  const marketIndex = getMarketHistoryIndex();
  return preview.slice(0, limit).map((entry, idx) => {
    const mid = typeof entry === 'string' ? entry : entry?.id;
    const meta = mid ? marketIndex[mid] : null;
    return {
      id: mid || `preview-${idx}`,
      name: meta?.q || mid || 'Sample market',
      cat: meta?.cat || null,
      prob: meta?.prob ?? null,
    };
  });
}

function renderProtectedRecipePreview(ind) {
  const previews = getProtectedPreviewMarkets(ind, 4);
  const hiddenCount = Math.max(0, getIndicatorMarketCount(ind) - previews.length);
  const rows = previews.map((m, idx) => {
    const prob = m.prob != null ? `${(m.prob * 100).toFixed(0)}%` : '--';
    return `
      <div class="flex items-start gap-3 py-3 border-b border-gray-800/50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-300 leading-snug truncate">${escapeHtml(m.name)}</div>
          <div class="mt-1 flex items-center gap-2 flex-wrap">
            ${m.cat ? `<span class="text-[10px] text-gray-500">${escapeHtml(m.cat.replace(/_/g, ' '))}</span>` : ''}
            <span class="text-[10px] text-gray-500">prob ${prob}</span>
            <span class="text-[10px] text-amber-300/80">sample ${idx + 1}</span>
          </div>
        </div>
        <div class="shrink-0 min-w-20 text-right">
          <div class="text-[10px] text-gray-600 uppercase tracking-wide">Weight</div>
          <div class="mt-1 h-5 w-16 rounded bg-gray-800/80 border border-gray-700/50 overflow-hidden">
            <div class="h-full bg-gray-600/70 blur-[3px]" style="width:${idx % 2 ? 62 : 78}%"></div>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="app-surface rounded-xl p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h3 class="text-sm font-medium text-gray-300">Sneak Peek</h3>
        <span class="text-[11px] text-gray-600">${hiddenCount} hidden</span>
      </div>
      ${rows || '<div class="text-sm text-gray-500 py-4">Market preview unavailable for this indicator.</div>'}
      <div class="mt-4 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/80 leading-relaxed">
        Market names are sampled; exact weights, inversions, and the rest of the recipe stay hidden.
      </div>
    </div>`;
}

async function forkIndicatorWithMarket(indicatorId, marketId) {
  const indicators = await getIndicators();
  let ind = indicators.find(i => i.id === indicatorId);
  if (!ind) {
    try {
      const res = await fetch('/api/indicators/' + indicatorId);
      if (res.ok) ind = await res.json();
    } catch (_) {}
  }
  if (!ind) return;
  if (!canForkIndicator(ind)) { protectedForkMessage(); return; }
  forkFromData(ind, indicatorId);
  builderState.selectedMarkets[marketId] = makeMarketConfig(marketId, 100, false, getMarketMeta(marketId));
}

async function renderIndicatorDetail() {
  const hash = location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const id = params.get('id');
  const container = document.getElementById('indicator-detail');
  if (!container || !id) { location.hash = '#indicators'; return; }

  if (detailChartInstance) { detailChartInstance.destroy(); detailChartInstance = null; }

  const indicators = await getIndicators();
  let ind = indicators.find(i => i.id === id);
  if (!ind) {
    container.innerHTML = '<div class="text-center py-12"><p class="text-gray-500">Indicator not found</p><a href="#indicators" class="text-blue-400 text-sm mt-2 inline-block">Back to indicators</a></div>';
    return;
  }

  const sector = ind.sector || 'crypto';
  const recipeProtected = isRecipeProtected(ind);
  if (recipeProtected && (!Array.isArray(ind.previewMarkets) || ind.previewMarkets.length === 0)) {
    try {
      const res = await fetch('/api/indicators/' + id);
      if (res.ok) ind = { ...ind, ...(await res.json()), _isOwned: ind._isOwned };
    } catch (_) {}
  }
  if (recipeProtected) {
    await ensureSectorsLoaded([sector]);
    await loadAssetData(sector, ind.asset);
  } else if (typeof ensureAllSectorAssetsLoaded === 'function') {
    await ensureAllSectorAssetsLoaded(SECTOR_ORDER);
  } else {
    await ensureSectorsLoaded(SECTOR_ORDER);
  }
  const sectorData = sectorDataCache[sector];

  const ts = (sectorData && canComputeIndicator(ind) && !recipeProtected) ? computeIndicatorTimeseries(ind, sectorData) : { dates: [], scores: [], prices: [] };
  const corr = computeCorrelation(ts.scores, ts.prices);
  const dirAcc = computeDirectionalAccuracy(ts.scores, ts.prices);
  const predictive = computePredictiveScore(ts.scores, ts.prices);
  const deltas = computePeriodDeltas(ts.scores, ts.dates);
  const lastScore = [...ts.scores].reverse().find(s => s != null) ?? getIndicatorScore(ind);
  const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
  const label = recipeProtected ? 'Protected' : (lastScore != null ? scoreLabel(lastScore) : '');
  const marketCount = getIndicatorMarketCount(ind);
  const escapedName = ind.name.replace(/'/g, "\\'");
  const viewCount = await recordIndicatorView(id, ind);
  const comments = await loadIndicatorComments(id);
  const relatedMarkets = recipeProtected ? [] : getRelatedMarketSuggestions(ind);

  const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(3) : '--';
  const corrClr = corr != null ? (Math.abs(corr) > 0.5 ? '#4ade80' : Math.abs(corr) > 0.3 ? '#fbbf24' : '#9ca3af') : '#6b7280';
  const dirAccStr = dirAcc != null ? dirAcc.toFixed(1) + '%' : '--';
  const dirAccClr = dirAcc != null ? (dirAcc > 55 ? '#4ade80' : dirAcc > 50 ? '#fbbf24' : '#9ca3af') : '#6b7280';
  const predStr = predictiveLabel(predictive);
  const predClr = predictiveColor(predictive, '#6b7280');
  const lagStr = predictive ? `${predictive.optimalLag}d` : '--';

  const refKey = resolveIndicatorReferenceAsset(ind, sector);
  const refMeta = typeof ALL_REFERENCE_ASSETS !== 'undefined' ? ALL_REFERENCE_ASSETS.find(a => a.key === refKey) : null;
  const refLabel = refKey ? (refMeta?.label || refKey) : 'No reference asset';
  const tracking = indicatorTrackingMeta(ind);
  const underlyingRefKey = underlyingAssetReferenceKey(tracking.primaryAsset);
  const underlyingRefLabel = underlyingRefKey ? referenceAssetLabel(underlyingRefKey) : null;
  const underlyingRefFmt = referenceAssetFormat(underlyingRefKey);
  const refMapForChart = sectorData?.refMap || sectorDataCache[sector]?.refMap || {};
  const underlyingPrices = underlyingRefKey
    ? ts.dates.map(d => refMapForChart[d]?.[underlyingRefKey] ?? null)
    : [];
  const hasUnderlyingPriceLine = underlyingPrices.some(v => v != null);
  const chartTitle = hasUnderlyingPriceLine
    ? `${tracking.assetLabel} sentiment + ${underlyingRefLabel}`
    : `${tracking.assetLabel} sentiment vs ${refLabel}`;
  const chartSubtitle = hasUnderlyingPriceLine
    ? `${tracking.assetDetail} · ${tracking.modeLabel} · underlying shown on chart`
    : `${tracking.assetDetail} · ${tracking.modeLabel}`;

  // Build markets list
  let marketsHtml = '';
  if (!recipeProtected && ind.markets && marketCount > 0) {
    const marketIndex = getMarketHistoryIndex();
    const entries = [];
    for (const [mid, rawW] of Object.entries(ind.markets)) {
      const w = typeof rawW === 'object' ? (rawW.w ?? 100) : (typeof rawW === 'number' ? rawW : 100);
      const flip = typeof rawW === 'object' ? !!rawW.flip : false;
      const cfgSector = typeof rawW === 'object' ? rawW.sector : null;
      const cfgAsset = typeof rawW === 'object' ? rawW.asset : null;
      const meta = marketIndex[`${cfgSector || sector}:${mid}`] || marketIndex[mid] || getMarketMeta(mid);
      entries.push({
        mid,
        name: meta?.q || mid,
        w,
        flip,
        prob: meta?.prob ?? null,
        cat: meta?.cat || null,
        sector: cfgSector || meta?.sector || sector,
        asset: cfgAsset || meta?.asset || ind.asset,
      });
    }
    entries.sort((a, b) => b.w - a.w);
    marketsHtml = entries.map(m => {
      const probStr = m.prob != null ? `${(m.prob * 100).toFixed(0)}%` : '';
      const mSector = SECTORS[m.sector]?.label || titleCaseAsset(m.sector);
      return `<div class="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-800/40 transition-colors text-sm">
        <div class="w-8 text-right text-[11px] tabular-nums text-gray-500 shrink-0">${m.w}%</div>
        ${m.flip ? '<span class="text-[10px] text-red-400/70 w-6 shrink-0">INV</span>' : '<span class="w-6 shrink-0"></span>'}
        <div class="flex-1 min-w-0">
          <div class="text-gray-300 truncate">${escapeHtml(m.name)}</div>
          <div class="mt-0.5 flex items-center gap-2 flex-wrap">
            <span class="text-[10px] text-gray-500">${escapeHtml(mSector)}</span>
            <span class="text-[10px] text-gray-500">${escapeHtml(titleCaseAsset(m.asset))}</span>
            ${m.cat ? `<span class="text-[10px] text-gray-600">${escapeHtml(m.cat.replace(/_/g, ' '))}</span>` : ''}
          </div>
        </div>
        ${probStr ? `<span class="text-[11px] tabular-nums text-gray-500 shrink-0">${probStr}</span>` : ''}
      </div>`;
    }).join('');
  }

  const relatedHtml = relatedMarkets.map(m => {
    const prob = m.prob != null ? `${(m.prob * 100).toFixed(0)}%` : '--';
    const vol = _fmtVol(m.vol) || '--';
    const sectorLabel = SECTORS[m._sId]?.label || m._sId;
    const safeMid = String(m.mid).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <div class="flex items-start gap-3 py-3 border-b border-gray-800/50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-300 leading-snug">${escapeHtml(m.q || m.mid)}</div>
          <div class="mt-1 flex items-center gap-2 flex-wrap">
            <span class="sector-chip">${escapeHtml(sectorLabel)}</span>
            <span class="text-[10px] text-gray-500">${escapeHtml(m._asset || 'OTHER')}</span>
            <span class="text-[10px] text-gray-500">${escapeHtml((m.cat || 'other').replace(/_/g, ' '))}</span>
            <span class="text-[10px] text-gray-500">prob ${prob}</span>
            <span class="text-[10px] text-gray-500">vol ${vol}</span>
            ${m._why ? `<span class="text-[10px] text-blue-400/80">${escapeHtml(m._why)}</span>` : ''}
          </div>
        </div>
        ${canForkIndicator(ind) ? `<button onclick="forkIndicatorWithMarket('${ind.id}','${safeMid}')" class="shrink-0 px-2.5 py-1.5 text-[11px] text-green-300 bg-green-500/10 border border-green-500/20 rounded-md hover:border-green-400/50 transition-colors">Fork + add</button>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="flex items-center gap-3 mb-6">
      <a href="#indicators" class="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-800/40">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      </a>
      <div class="flex-1 min-w-0">
        <h1 class="text-xl font-semibold text-gray-100 truncate">${escapeHtml(ind.name)}</h1>
        <p class="text-sm text-gray-400 mt-1">${escapeHtml(tracking.sentence)}</p>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          ${!ind._isOwned && (ind.creator || ind.creatorName) ? `<span class="text-[10px] text-gray-500">by ${escapeHtml(ind.creator || ind.creatorName)}</span>` : ''}
          ${ind.sector ? `<span class="sector-chip">${escapeHtml(SECTORS[ind.sector]?.label || ind.sector)}</span>` : ''}
          <span class="text-[10px] text-gray-500">underlying ${escapeHtml(tracking.assetLabel)}</span>
          <span class="text-[10px] text-gray-500">${escapeHtml(tracking.modeLabel)}</span>
          ${indicatorProtectionBadge(ind)}
          ${marketCount > 0 ? `<span class="text-[10px] text-gray-600">${marketCount} markets</span>` : ''}
          ${ind.fgEnabled ? '<span class="text-[10px] text-green-500/80">F&G blended</span>' : ''}
          <span class="text-[10px] text-gray-600">vs ${escapeHtml(refLabel)}</span>
          <span class="text-[10px] text-gray-600">${viewCount.toLocaleString()} views</span>
          <span class="text-[10px] text-gray-600"><span id="indicator-comment-count">${comments.length}</span> comments</span>
          ${ind.publishedAt ? `<span class="text-[10px] text-gray-600">Published ${new Date(ind.publishedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>` : ''}
          ${(ind.forkCount || 0) > 0 ? `<span class="text-[10px] text-blue-400">${ind.forkCount} fork${ind.forkCount !== 1 ? 's' : ''}</span>` : ''}
          ${ind.forkedFrom ? `<span class="text-[10px] text-gray-500">Forked from <a href="#indicator?id=${ind.forkedFrom}" class="text-blue-400 hover:underline" onclick="event.stopPropagation()">source</a></span>` : ''}
        </div>
      </div>
      <div class="flex gap-2">
        ${ind._isOwned ? `
        <button onclick="editIndicator('${ind.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 bg-gray-800/60 border border-gray-700/40 rounded-lg hover:border-blue-500/40 hover:text-blue-400 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          Edit
        </button>
        <button onclick="confirmDeleteIndicator('${ind.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 bg-gray-800/60 border border-gray-700/40 rounded-lg hover:border-red-500/40 hover:text-red-400 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          Delete
        </button>
        ` : `
        ${canForkIndicator(ind) ? `<button onclick="forkIndicator('${ind.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 bg-gray-800/60 border border-gray-700/40 rounded-lg hover:border-green-500/40 hover:text-green-400 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4h10v10H4zM10 10h10v10H10z"/></svg>
          Fork
        </button>` : `<button onclick="protectedForkMessage()" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10V9a3 3 0 116 0v2"/></svg>
          Protected
        </button>`}
        `}
      </div>
    </div>

    <div class="flex items-center gap-6 mb-6 flex-wrap">
      <div class="flex items-center gap-4">
        ${scoreRingSvg(lastScore, sColor, 72)}
        <div><div class="text-sm text-gray-400">${label}</div></div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="stat-pill"><span class="text-gray-600 text-[10px]">r</span> <span style="color:${corrClr}">${corrStr}</span></span>
        <span class="stat-pill"><span class="text-gray-600 text-[10px]">dir acc</span> <span style="color:${dirAccClr}">${dirAccStr}</span></span>
        <span class="stat-pill"><span class="text-gray-600 text-[10px]">pred</span> <span style="color:${predClr}">${predStr}</span></span>
        <span class="stat-pill"><span class="text-gray-600 text-[10px]">lag</span> ${lagStr}</span>
        <span class="stat-pill">${fmtDelta(deltas['1W'])} <span class="text-gray-600 text-[10px] ml-0.5">7d</span></span>
        <span class="stat-pill">${fmtDelta(deltas['1M'])} <span class="text-gray-600 text-[10px] ml-0.5">30d</span></span>
        <span class="stat-pill">${fmtDelta(deltas['3M'])} <span class="text-gray-600 text-[10px] ml-0.5">90d</span></span>
      </div>
    </div>

    <div class="app-surface rounded-xl p-5 mb-6">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-sm font-medium text-gray-200">${escapeHtml(chartTitle)}</h2>
          <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(chartSubtitle)}</p>
        </div>
        <div class="hidden sm:flex items-center gap-2 text-[11px]">
          <span class="stat-pill">Underlying ${escapeHtml(tracking.assetLabel)}</span>
          <span class="stat-pill">${escapeHtml(tracking.benchmarkText)}</span>
          <span class="text-gray-600">${ts.dates.length ? `${ts.dates.length} obs` : 'No chart data'}</span>
        </div>
      </div>
      <div style="height:320px"><canvas id="detail-chart"></canvas></div>
    </div>

	    ${recipeProtected ? renderProtectedRecipePreview(ind) : (marketCount > 0 ? `
	    <div class="app-surface rounded-xl p-5">
	      <h3 class="text-sm font-medium text-gray-300 mb-3">Markets <span class="text-gray-600 font-normal">(${marketCount})</span></h3>
	      <div class="max-h-[400px] overflow-y-auto space-y-0.5">${marketsHtml}</div>
	    </div>` : '')}

	    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
	      <div class="app-surface rounded-xl p-5">
	        <div class="flex items-center justify-between gap-3 mb-4">
	          <h3 class="text-sm font-medium text-gray-300">Comments</h3>
	          <span class="text-[11px] text-gray-600"><span id="indicator-comment-total">${comments.length}</span> total</span>
	        </div>
	        <div class="space-y-3 mb-4">
	          <div class="text-xs text-gray-500">Posting as <span class="text-gray-300">${escapeHtml(currentCommentAuthorLabel())}</span></div>
	          <textarea id="indicator-comment-body" maxlength="1000" rows="3" class="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:border-blue-500/50 resize-none" placeholder="Add a comment"></textarea>
	          <div class="flex items-center justify-between gap-3">
	            <div id="indicator-comment-error" class="text-xs text-red-400"></div>
	            <button onclick="submitIndicatorComment('${ind.id}')" class="px-3 py-1.5 text-xs text-blue-200 bg-blue-500/10 border border-blue-500/20 rounded-lg hover:border-blue-400/50 transition-colors">Post</button>
	          </div>
	        </div>
	        <div id="indicator-comments-list" class="max-h-[360px] overflow-y-auto"></div>
	      </div>

	      ${recipeProtected ? '' : `<div class="app-surface rounded-xl p-5">
	        <div class="flex items-center justify-between gap-3 mb-4">
	          <h3 class="text-sm font-medium text-gray-300">Related Markets</h3>
	          <span class="text-[11px] text-gray-600">${relatedMarkets.length} suggestions</span>
	        </div>
	        <div class="max-h-[500px] overflow-y-auto">
	          ${relatedHtml || '<div class="text-sm text-gray-500 py-5">No related markets found in the loaded dataset.</div>'}
	        </div>
	      </div>`}
	    </div>
	  `;

  renderIndicatorComments(id, comments);

  // Render chart
  requestAnimationFrame(() => {
    const canvas = document.getElementById('detail-chart');
    if (!canvas) return;
    const refFmt = refMeta?.format || '$';
    const formatChartValue = (value, fmt) => {
      if (fmt === '%') return value.toFixed(2) + '%';
      if (fmt === '0-100' || fmt === '#') return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
      return '$' + value.toLocaleString();
    };
    const tickCb = (v) => {
      const fmt = hasUnderlyingPriceLine ? underlyingRefFmt : refFmt;
      if (fmt === '%') return v.toFixed(1) + '%';
      if (fmt === '0-100' || fmt === '#') return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return v >= 1000 ? '$' + (v/1000).toFixed(0) + 'K' : '$' + v.toFixed(0);
    };

    detailChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: ts.dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [
          {
            label: `${tracking.assetLabel} sentiment`,
            data: ts.scores,
            borderColor: '#60a5fa',
            backgroundColor: 'rgba(96,165,250,0.08)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 8,
            yAxisID: 'y',
          },
          ...(hasUnderlyingPriceLine ? [{
            label: underlyingRefLabel,
            data: underlyingPrices,
            borderColor: '#c4b5fd',
            borderWidth: 1.6,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 8,
            yAxisID: 'y2',
            fmt: underlyingRefFmt,
          }] : []),
          ...(ts.prices.some(p => p != null) && refKey !== underlyingRefKey ? [{
            label: refLabel,
            data: ts.prices,
            borderColor: '#9ca3af',
            borderWidth: 1.5,
            borderDash: [4, 3],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 8,
            yAxisID: 'y2',
            fmt: refFmt,
          }] : []),
        ],
      },
      plugins: [typeof neutralLinePlugin !== 'undefined' ? neutralLinePlugin : {}],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#9ca3af', usePointStyle: true, pointStyle: 'line', padding: 16, font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.95)',
            titleColor: '#e5e7eb', bodyColor: '#9ca3af',
            borderColor: '#374151', borderWidth: 1, padding: 12,
            callbacks: {
              label(ctx) {
                const val = ctx.parsed.y;
                if (val == null) return null;
                if (ctx.dataset.yAxisID === 'y2') {
                  return ctx.dataset.label + ': ' + formatChartValue(val, ctx.dataset.fmt || refFmt);
                }
                return ctx.dataset.label + ': ' + val.toFixed(1) + '/100';
              },
            },
          },
        },
        scales: {
          y: {
            type: 'linear', position: 'left', min: 0, max: 100,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#6b7280', font: { size: 11 } },
            title: { display: true, text: 'Score (0-100)', color: '#6b7280', font: { size: 11 } },
          },
          y2: {
            type: 'linear', position: 'right', display: ts.prices.some(p => p != null),
            grid: { display: false },
            ticks: { color: '#9ca3af', font: { size: 11 }, callback: tickCb },
            title: { display: true, text: refLabel, color: '#9ca3af', font: { size: 11 } },
          },
          x: {
            grid: { display: false },
            ticks: { color: '#6b7280', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 12 },
          },
        },
      },
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE 2: BUILDER (Sector-aware)
// ═════════════════════════════════════════════════════════════════════════════

function showBuilderLanding() {
  document.getElementById('builder-choice')?.classList.remove('hidden');
  document.getElementById('builder-workspace')?.classList.add('hidden');
}

function showBuilderWorkspace() {
  document.getElementById('builder-choice')?.classList.add('hidden');
  document.getElementById('builder-workspace')?.classList.remove('hidden');
}

function clearBuilderFormValues() {
  const nameEl = document.getElementById('builder-name');
  if (nameEl) nameEl.value = '';
  const sectorEl = document.getElementById('builder-target-sector');
  if (sectorEl) sectorEl.value = builderState.targetSector || 'crypto';
  syncBuilderTargetControls();
  for (const id of ['bp-10', 'bp-50', 'bp-100', 'bp-500']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
}

function resetBuilderDraft() {
  if (builderState.chartInstance) {
    builderState.chartInstance.destroy();
    builderState.chartInstance = null;
  }
  builderState.selectedMarkets = {};
  builderState.targetSector = 'crypto';
  builderState.targetAssetKey = 'btc_price';
  builderState.targetAsset = 'BTC';
  builderState.fgEnabled = false;
  builderState.fgWeight = 30;
  builderState.chartPeriod = 'ALL';
  builderState.editingId = null;
  builderState.initialized = false;
  builderState.builderStarted = true;
  builderState.marketSearch = '';
  builderState.referenceAsset = 'btc_price';
  delete builderState._pendingName;
  delete builderState._pendingForkedFrom;
  delete builderState._pendingForkSource;
  delete builderState._forkLoaded;
  clearBuilderFormValues();
}

function targetAssetOptionsForSector(sectorId) {
  const allowedSector = sectorId && sectorId !== 'all' ? sectorId : null;
  return (ALL_REFERENCE_ASSETS || [])
    .filter(a => a.key && a.key !== 'fear_greed')
    .filter(a => !allowedSector || a.sector === allowedSector)
    .map(a => ({
      key: a.key,
      label: a.label,
      sector: a.sector,
    }));
}

function defaultTargetForSector(sectorId) {
  const opts = targetAssetOptionsForSector(sectorId);
  if (opts.length > 0) return opts[0];
  return { key: 'other', label: sectorId === 'politics' ? 'Election or policy theme' : 'Qualitative theme' };
}

function targetKeyForAsset(asset) {
  const normalized = String(asset || '').trim().toLowerCase();
  if (!normalized) return null;
  const match = (ALL_REFERENCE_ASSETS || [])
    .filter(a => a.key && a.key !== 'fear_greed')
    .find(a => a.label.toLowerCase() === normalized || a.id?.toLowerCase() === normalized || a.key?.toLowerCase() === normalized);
  return match?.key || null;
}

function setBuilderTargetFromIndicator(ind = {}) {
  builderState.targetSector = ind.sector || builderState.targetSector || 'crypto';
  const key = ind.referenceAsset ?? targetKeyForAsset(ind.asset);
  const ref = key ? (ALL_REFERENCE_ASSETS || []).find(a => a.key === key) : null;
  if (ref) {
    builderState.targetAssetKey = ref.key;
    builderState.targetAsset = ref.label;
  } else {
    builderState.targetAssetKey = 'other';
    builderState.targetAsset = ind.asset || builderState.targetAsset || '';
  }
}

function syncBuilderTargetControls() {
  const sectorEl = document.getElementById('builder-target-sector');
  if (sectorEl && sectorEl.value !== (builderState.targetSector || 'all')) sectorEl.value = builderState.targetSector || 'all';
  const selectEl = document.getElementById('builder-target-asset-select');
  const customWrap = document.getElementById('builder-target-custom-wrap');
  const customEl = document.getElementById('builder-target-asset-custom');
  const opts = targetAssetOptionsForSector(builderState.targetSector);
  const currentKey = builderState.targetAssetKey || targetKeyForAsset(builderState.targetAsset) || 'other';
  if (selectEl) {
    selectEl.innerHTML = [
      ...opts.map(opt => `<option value="${opt.key}">${escapeHtml(opt.label)}</option>`),
      '<option value="other">Other / qualitative</option>',
    ].join('');
    selectEl.value = opts.some(opt => opt.key === currentKey) ? currentKey : 'other';
  }
  const isOther = !opts.some(opt => opt.key === currentKey);
  customWrap?.classList.toggle('hidden', !isOther);
  if (customEl && customEl.value !== (isOther ? (builderState.targetAsset || '') : '')) {
    customEl.value = isOther ? (builderState.targetAsset || '') : '';
  }
  const note = document.getElementById('builder-target-note');
  if (note) {
    const sector = builderState.targetSector === 'all' ? 'all domains' : (SECTORS[builderState.targetSector]?.label || builderState.targetSector);
    const asset = String(builderState.targetAsset || '').trim();
    note.textContent = asset ? `Showing ${sector} markets related to "${asset}"` : `Showing ${sector} markets`;
  }
}

function setBuilderTargetSector(sector) {
  builderState.targetSector = sector || 'all';
  const next = defaultTargetForSector(builderState.targetSector);
  builderState.targetAssetKey = next.key === 'other' ? 'other' : next.key;
  builderState.targetAsset = next.label;
  if (!builderState.editingId) {
    builderState.referenceAsset = next.key === 'other' ? null : next.key;
  }
  renderBuilderTestAgainst();
  syncBuilderTargetControls();
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function setBuilderTargetAssetChoice(value) {
  const key = value || 'other';
  if (key === 'other') {
    builderState.targetAssetKey = 'other';
    if (!builderState.targetAsset || targetKeyForAsset(builderState.targetAsset)) {
      builderState.targetAsset = '';
    }
    builderState.referenceAsset = null;
  } else {
    const opt = targetAssetOptionsForSector(builderState.targetSector).find(a => a.key === key)
      || (ALL_REFERENCE_ASSETS || []).find(a => a.key === key);
    builderState.targetAssetKey = key;
    builderState.targetAsset = opt?.label || key;
    builderState.referenceAsset = key;
  }
  renderBuilderTestAgainst();
  syncBuilderTargetControls();
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function setBuilderCustomTarget(value) {
  builderState.targetAssetKey = 'other';
  builderState.targetAsset = String(value || '').trim();
  syncBuilderTargetControls();
  renderBuilderMarketPicker();
}

function startNewBuilder() {
  resetBuilderDraft();
  if ((location.hash || '').split('?')[0] === '#builder') {
    renderBuilderPage();
  } else {
    location.hash = '#builder';
  }
}

function hasBuilderContext(editId, forkId) {
  return !!(
    editId ||
    forkId ||
    builderState.builderStarted ||
    builderState.editingId ||
    builderState._pendingForkedFrom ||
    builderState._pendingName
  );
}

function copyIndicatorMarketsToBuilder(ind) {
  if (!ind) return;
  setBuilderTargetFromIndicator(ind);
  if (ind.markets) {
    builderState.selectedMarkets = typeof ind.markets === 'object'
      ? normalizeMarketConfig(ind.markets, ind.sector || 'crypto')
      : {};
  } else if (ind.weights) {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset, ind.sector || 'crypto');
  } else {
    builderState.selectedMarkets = {};
  }
}

async function renderBuilderPage() {
  const hash = location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const editId = params.get('id');
  const forkId = params.get('fork');

  if (!hasBuilderContext(editId, forkId)) {
    showBuilderLanding();
    return;
  }

  showBuilderWorkspace();
  builderState.builderStarted = true;

  // Fork from an existing indicator via URL param
  if (forkId && !builderState._forkLoaded) {
    builderState._forkLoaded = forkId;
    const cached = (await getIndicators()).find(i => i.id === forkId);
    if (cached) {
      forkFromData(cached, forkId);
      return;
    }
    try {
      const res = await fetch('/api/indicators/' + forkId);
      if (res.ok) {
        const ind = await res.json();
        forkFromData(ind, forkId);
        return; // forkFromData navigates to #builder, which re-triggers render
      }
    } catch (err) { console.error('Fork load failed:', err); }
  }

  // If editing, load from indicator
  if (editId && editId !== builderState.editingId) {
    builderState.editingId = editId;
    const ind = (await getIndicators()).find(i => i.id === editId);
    if (ind) {
      setBuilderTargetFromIndicator(ind);
      builderState.fgEnabled = ind.fgEnabled || false;
      builderState.fgWeight = ind.fgWeight || 30;
      builderState.referenceAsset = ind.referenceAsset ?? builderState.referenceAsset ?? null;
      const nameEl = document.getElementById('builder-name');
      if (nameEl) nameEl.value = ind.name || builderState._pendingName || '';
    }
  } else if (!editId) {
    const nameEl = document.getElementById('builder-name');
    if (nameEl && !nameEl.value && builderState._pendingName) {
      nameEl.value = builderState._pendingName;
      delete builderState._pendingName;
    }
  }

  // Load ALL available sectors — every market is available
  await ensureSectorsLoaded(SECTOR_ORDER);

  if (builderState._pendingForkSource) {
    copyIndicatorMarketsToBuilder(builderState._pendingForkSource);
    delete builderState._pendingForkSource;
  }

  // Set default reference asset
  if (!builderState.referenceAsset && !builderState.editingId) {
    builderState.referenceAsset = 'btc_price';
  }

  // Load indicator markets after data is available
  if (editId && editId === builderState.editingId) {
    const ind = (await getIndicators()).find(i => i.id === editId);
    if (ind) {
      if (ind.markets) {
        builderState.selectedMarkets = normalizeMarketConfig(ind.markets, ind.sector || 'crypto');
      } else if (ind.weights) {
        const sectorData = sectorDataCache[ind.sector || 'crypto'];
        builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset, ind.sector || 'crypto');
      }
    }
  }

  renderBuilderMarketPicker();
  renderBuilderTestAgainst();
  renderBuilderSignalSources();
  syncBuilderControls();
  syncBuilderTargetControls();
  syncBuilderTargetControls();

  if (!builderState.initialized) {
    initBuilderChart();
    builderState.initialized = true;
  }

  updateBuilderChart();
}

// ── Market config normalizer for cross-sector ──────────────────────────────

function normalizeMarketConfig(markets, defaultSector) {
  const out = {};
  for (const [mid, val] of Object.entries(markets)) {
    if (typeof val === 'number') {
      out[mid] = { w: val, flip: false, sector: defaultSector || null };
    } else if (typeof val === 'object' && val !== null) {
      out[mid] = {
        w: val.w ?? val.weight ?? 100,
        flip: !!val.flip,
        sector: val.sector || defaultSector || null,
        asset: val.asset || null,
      };
    } else {
      out[mid] = { w: 100, flip: false, sector: defaultSector || null };
    }
  }
  return out;
}

// Migrate legacy category weights to per-market selection
function migrateWeightsToMarkets(weights, includeOther, sectorData, asset, defaultSector) {
  const assetData = sectorData?.sandbox?.assets?.[asset];
  if (!assetData?.markets) return {};
  const selected = {};
  for (const [mid, m] of Object.entries(assetData.markets)) {
    const catWeight = weights[m.cat];
    if (catWeight != null && catWeight > 0) {
      selected[mid] = { w: catWeight, flip: false, sector: defaultSector || null, asset };
    } else if (m.cat === 'other' && includeOther && (weights.other || 0) > 0) {
      selected[mid] = { w: weights.other, flip: false, sector: defaultSector || null, asset };
    }
  }
  return selected;
}

// ── Builder Market Picker (flat unified list of all markets) ──────────────

function _getAllMarkets() {
  // Build one flat array of all markets across all loaded sectors/assets
  const all = [];
  for (const sId of SECTOR_ORDER) {
    const sd = sectorDataCache[sId];
    if (!sd?.sandbox?.assets) continue;
    for (const [asset, assetData] of Object.entries(sd.sandbox.assets)) {
      if (!assetData?.markets) continue;
      for (const [mid, m] of Object.entries(assetData.markets)) {
        const latestWt = m.wt ? m.wt[m.wt.length - 1] || 0 : 0;
        // Latest signal value (for probability display)
        const latestSs = m.ss ? m.ss.filter(v => v != null).pop() || null : null;
        all.push({
          mid, q: m.q, cat: m.cat, latestWt, ss: m.ss, wt: m.wt,
          end: m.end || null, prob: m.prob ?? null, vol: m.vol || 0,
          latestSs, _sId: sId, _asset: asset,
        });
      }
    }
  }
  return all;
}

function getMarketMeta(mid) {
  const scopedSector = builderState.targetSector && builderState.targetSector !== 'all' ? builderState.targetSector : null;
  return _getAllMarkets().find(m => m.mid === mid && (!scopedSector || m._sId === scopedSector))
    || _getAllMarkets().find(m => m.mid === mid)
    || null;
}

function makeMarketConfig(mid, weight = 100, flip = false, meta = null) {
  const m = meta || getMarketMeta(mid);
  return {
    w: weight,
    flip,
    sector: m?._sId || null,
    asset: m?._asset || null,
  };
}

function _filterAndSortMarkets(all) {
  const search = builderState.marketSearch.toLowerCase();
  const targetSector = builderState.targetSector || 'all';
  const targetAsset = String(builderState.targetAsset || '').trim().toLowerCase();
  const hideExpired = document.getElementById('builder-hide-expired')?.checked ?? true;
  const hideResolved = document.getElementById('builder-hide-resolved')?.checked ?? true;
  const sortBy = document.getElementById('builder-market-sort')?.value || 'relevance';
  const today = new Date().toISOString().slice(0, 10);

  let filtered = all;
  if (targetSector !== 'all') filtered = filtered.filter(m => m._sId === targetSector);
  if (targetAsset) {
    filtered = filtered.filter(m => {
      const q = String(m.q || '').toLowerCase();
      const asset = String(m._asset || '').toLowerCase();
      const cat = String(m.cat || '').toLowerCase().replace(/_/g, ' ');
      return asset === targetAsset || q.includes(targetAsset) || cat.includes(targetAsset);
    });
  }
  if (search) filtered = filtered.filter(m => m.q.toLowerCase().includes(search));
  if (hideExpired) filtered = filtered.filter(m => !m.end || m.end >= today);
  if (hideResolved) filtered = filtered.filter(m => m.prob == null || (m.prob > 0.02 && m.prob < 0.98));

  switch (sortBy) {
    case 'relevance':
      filtered.sort((a, b) => _marketRelevanceScore(b, targetAsset) - _marketRelevanceScore(a, targetAsset) || (b.vol || 0) - (a.vol || 0) || b.latestWt - a.latestWt);
      break;
    case 'volume': filtered.sort((a, b) => (b.vol || 0) - (a.vol || 0) || b.latestWt - a.latestWt); break;
    case 'resolution': filtered.sort((a, b) => {
      const ae = a.end || '9999'; const be = b.end || '9999';
      return ae < be ? -1 : ae > be ? 1 : 0;
    }); break;
    case 'prob_high': filtered.sort((a, b) => (b.prob ?? 0.5) - (a.prob ?? 0.5)); break;
    case 'prob_low': filtered.sort((a, b) => (a.prob ?? 0.5) - (b.prob ?? 0.5)); break;
    case 'alpha': filtered.sort((a, b) => a.q.localeCompare(b.q)); break;
  }
  return filtered;
}

function _marketRelevanceScore(m, targetAsset) {
  let score = 0;
  const q = String(m.q || '').toLowerCase();
  const asset = String(m._asset || '').toLowerCase();
  const t = String(targetAsset || '').toLowerCase();
  if (t && asset === t) score += 100;
  if (t && q.includes(t)) score += 45;
  if (m.prob != null && m.prob > 0.02 && m.prob < 0.98) score += 20;
  if (m.end && m.end >= new Date().toISOString().slice(0, 10)) score += 15;
  score += Math.min(20, Math.log10((m.vol || 0) + 1) * 3);
  return score;
}

function _fmtEndDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _fmtEndDateShort(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _fmtVol(n) {
  if (!n) return '';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function _getCatMeta() {
  const catMeta = {};
  for (const sId of SECTOR_ORDER) {
    const s = SECTORS[sId];
    if (!s?.categories) continue;
    for (const [cat, meta] of Object.entries(s.categories)) {
      if (!catMeta[cat]) catMeta[cat] = meta;
    }
  }
  return catMeta;
}

function renderBuilderBasket() {
  const el = document.getElementById('builder-basket');
  if (!el) return;

  const selected = builderState.selectedMarkets;
  const count = Object.keys(selected).length;
  if (count === 0) {
    el.innerHTML = `<div class="text-center pb-2">
      <div class="text-xs text-gray-400">No markets selected</div>
      <div class="text-[10px] text-gray-500 mt-0.5">Check markets below to build</div>
    </div>`;
    return;
  }

  const catMeta = _getCatMeta();
  const all = _getAllMarkets();
  const byMid = {};
  for (const m of all) byMid[m.mid] = m;

  // Group selected by category, count flipped
  const catCounts = {};
  let flippedCount = 0;
  for (const [mid, cfg] of Object.entries(selected)) {
    const m = byMid[mid];
    const cat = m ? (catMeta[m.cat] ? m.cat : 'other') : 'other';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    if (isMarketFlipped(cfg)) flippedCount++;
  }

  const pills = Object.entries(catCounts).map(([cat, n]) => {
    const meta = catMeta[cat] || { label: cat, accent: '#6b7280' };
    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]" style="background:${meta.accent}15;color:${meta.accent}">${meta.label} <b>${n}</b></span>`;
  }).join(' ');

  const flipNote = flippedCount > 0
    ? `<span class="text-[10px] text-red-400/70">${flippedCount} inverted</span>` : '';

  el.innerHTML = `
    <div class="flex items-center justify-between mb-1.5">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-gray-300">${count} market${count !== 1 ? 's' : ''}</span>
        ${flipNote}
      </div>
      <button onclick="builderState.selectedMarkets={};renderBuilderMarketPicker();updateBuilderChart()" class="text-[10px] text-gray-500 hover:text-red-400 transition-colors">Clear</button>
    </div>
    <div class="flex flex-wrap gap-1 pb-2">${pills}</div>`;
}

function renderBuilderMarketPicker() {
  const el = document.getElementById('builder-market-picker');
  if (!el) return;

  const all = _getAllMarkets();
  const filtered = _filterAndSortMarkets(all);
  const catMeta = _getCatMeta();

  // Update count label
  const countEl = document.getElementById('builder-market-count');
  if (countEl) countEl.textContent = filtered.length + ' / ' + all.length;

  // Group by category
  const grouped = {};
  for (const m of filtered) {
    const cat = catMeta[m.cat] ? m.cat : 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }

  const catOrder = ['price_targets', 'regulatory', 'adoption', 'events',
    'earnings', 'corporate', 'monetary_policy', 'inflation', 'growth', 'employment',
    'favors_incumbent', 'favors_challenger', 'legislative', 'judicial', 'geopolitical', 'other'];

  let html = '';
  let hasContent = false;

  for (const cat of catOrder) {
    const list = grouped[cat];
    if (!list || list.length === 0) continue;
    hasContent = true;

    const meta = catMeta[cat] || { label: cat, accent: '#6b7280' };
    const selectedInCat = list.filter(m => builderState.selectedMarkets[m.mid] != null);
    const collapsed = builderState._collapsedCats?.[cat] ?? false;

    html += `<div>
      <div class="flex items-center justify-between mb-1 cursor-pointer select-none group/cat" onclick="toggleCatCollapse('${cat}')">
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-gray-500 w-2.5">${collapsed ? '▸' : '▾'}</span>
          <span class="text-[11px] font-semibold" style="color:${meta.accent}">${meta.label}</span>
          <span class="text-[10px] text-gray-500 tabular-nums">${selectedInCat.length}/${list.length}</span>
        </div>
        <div class="flex gap-1.5 opacity-0 group-hover/cat:opacity-100 transition-opacity" onclick="event.stopPropagation()">
          <button onclick="selectAllMarketsInCat('${cat}',true)" class="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">All</button>
          <button onclick="selectAllMarketsInCat('${cat}',false)" class="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">None</button>
        </div>
      </div>`;

    if (!collapsed) {
      for (const m of list) {
        const isSelected = builderState.selectedMarkets[m.mid] != null;
        const mktCfg = builderState.selectedMarkets[m.mid];
        const weight = getMarketWeight(mktCfg);
        const flipped = isMarketFlipped(mktCfg);
        const probPct = m.prob != null ? Math.round(m.prob * 100) : null;
        const endShort = _fmtEndDateShort(m.end);
        const volStr = _fmtVol(m.vol);
        const selectedBg = isSelected
          ? (flipped ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20')
          : 'border-transparent hover:bg-gray-700/20';

        html += `
          <div class="flex items-start gap-2 py-1.5 px-2 rounded border ${selectedBg} transition-colors group/row cursor-pointer" onclick="toggleMarketFromRow('${m.mid}', event)">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleMarket('${m.mid}', this.checked); event.stopPropagation()"
              class="rounded bg-gray-700 border-gray-600 w-3 h-3 shrink-0 cursor-pointer mt-0.5" style="accent-color:${meta.accent}">
            <div class="flex-1 min-w-0">
              <div class="text-xs leading-tight ${isSelected ? 'text-gray-100' : 'text-gray-400'}" title="${m.q}">
                ${flipped ? '<span class="text-red-400 font-medium mr-0.5" title="Inverted signal">&minus;</span>' : ''}${m.q}
              </div>
              <div class="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                ${probPct != null ? `<span class="tabular-nums">${probPct}%</span>` : ''}
                ${volStr ? `<span>${volStr}</span>` : ''}
                ${endShort ? `<span>${endShort}</span>` : ''}
              </div>
            </div>
            ${isSelected ? `
              <div class="flex items-center gap-1 shrink-0 mt-0.5">
                <button onclick="toggleMarketFlip('${m.mid}', event)" title="${flipped ? 'Signal inverted (click to restore)' : 'Invert signal (bearish)'}"
                  class="w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors ${flipped ? 'bg-red-500/20 text-red-400' : 'text-gray-500 hover:text-gray-400 hover:bg-gray-700/50'}">&plusmn;</button>
                <input type="range" min="0" max="200" value="${weight}" step="5"
                  data-mid="${m.mid}" oninput="onMarketWeightSlider(this)" onclick="event.stopPropagation()"
                  class="w-12 h-1 rounded-full appearance-none cursor-pointer bg-gray-800"
                  style="accent-color:${flipped ? '#ef4444' : meta.accent}">
                <span class="text-[10px] text-gray-500 tabular-nums w-7 text-right" id="mw-${m.mid}">${weight}%</span>
              </div>
            ` : ''}
          </div>`;
      }
    }
    html += '</div>';
  }

  if (!hasContent) {
    html = `<div class="text-center py-8">
      <div class="text-xs text-gray-400">No markets match filters</div>
      <div class="text-[10px] text-gray-500 mt-1">Try adjusting search or unchecking filters</div>
    </div>`;
  }

  el.innerHTML = html;
  renderBuilderBasket();
}

function toggleMarketFromRow(mid, event) {
  if (event.target.tagName === 'INPUT') return;
  const isSelected = builderState.selectedMarkets[mid] != null;
  toggleMarket(mid, !isSelected);
}

function toggleCatCollapse(cat) {
  if (!builderState._collapsedCats) builderState._collapsedCats = {};
  builderState._collapsedCats[cat] = !builderState._collapsedCats[cat];
  renderBuilderMarketPicker();
}

function onBuilderMarketSort() { renderBuilderMarketPicker(); }
function onBuilderFilterChange() { renderBuilderMarketPicker(); }

function selectAllMarketsInCat(cat, select) {
  const all = _getAllMarkets();
  const filtered = _filterAndSortMarkets(all);
  for (const m of filtered) {
    if (m.cat !== cat && cat !== 'other') continue;
    if (cat === 'other' && Object.keys(SECTORS).some(sId => SECTORS[sId]?.categories?.[m.cat])) continue;
    if (m.cat !== cat) continue;
    if (select) {
      if (builderState.selectedMarkets[m.mid] == null) builderState.selectedMarkets[m.mid] = makeMarketConfig(m.mid, 100, false, m);
    } else {
      delete builderState.selectedMarkets[m.mid];
    }
  }
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function onBuilderMarketSearch(val) {
  builderState.marketSearch = val;
  renderBuilderMarketPicker();
}

function toggleMarket(mid, checked) {
  if (checked) {
    builderState.selectedMarkets[mid] = makeMarketConfig(mid);
  } else {
    delete builderState.selectedMarkets[mid];
  }
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function onMarketWeightSlider(input) {
  const mid = input.dataset.mid;
  const val = parseInt(input.value);
  const prev = builderState.selectedMarkets[mid];
  builderState.selectedMarkets[mid] = makeMarketConfig(mid, val, isMarketFlipped(prev));
  const label = document.getElementById('mw-' + mid);
  if (label) label.textContent = val + '%';
  updateBuilderChart();
}

function toggleMarketFlip(mid, event) {
  if (event) event.stopPropagation();
  const prev = builderState.selectedMarkets[mid];
  if (!prev) return;
  builderState.selectedMarkets[mid] = makeMarketConfig(mid, getMarketWeight(prev), !isMarketFlipped(prev));
  renderBuilderMarketPicker();
  updateBuilderChart();
}


function onBuilderFgSliderChange() {
  const blend = document.getElementById('builder-fg-blend');
  if (blend) {
    builderState.fgWeight = parseInt(blend.value);
    document.getElementById('builder-fg-blend-val').textContent = blend.value + '%';
  }
  updateBuilderChart();
}

function onBuilderControlChange() {
  const fgEl = document.getElementById('builder-fg-enabled');
  builderState.fgEnabled = fgEl?.checked || false;
  const blendWrap = document.getElementById('builder-fg-blend-wrap');
  if (blendWrap) blendWrap.classList.toggle('hidden', !builderState.fgEnabled);
  updateBuilderChart();
}

function syncBuilderControls() {
  const fgEl = document.getElementById('builder-fg-enabled');
  if (fgEl) fgEl.checked = builderState.fgEnabled;
  const blendWrap = document.getElementById('builder-fg-blend-wrap');
  if (blendWrap) blendWrap.classList.toggle('hidden', !builderState.fgEnabled);
  const blendEl = document.getElementById('builder-fg-blend');
  if (blendEl) blendEl.value = builderState.fgWeight;
  const blendVal = document.getElementById('builder-fg-blend-val');
  if (blendVal) blendVal.textContent = builderState.fgWeight + '%';
}

// ── "Test Against" dropdown ──────────────────────────────────────────────

function renderBuilderTestAgainst() {
  const testAgainstEl = document.getElementById('builder-test-against');
  if (!testAgainstEl) return;

  const currentRef = builderState.referenceAsset || 'none';
  const groups = { crypto: 'Crypto', stocks: 'Equities', economy: 'Rates & Macro', commodities: 'Commodities' };
  let opts = '';
  let lastSector = null;
  for (const a of ALL_REFERENCE_ASSETS) {
    const sector = a.sector || '__none__';
    if (sector !== lastSector) {
      if (lastSector && lastSector !== '__none__') opts += '</optgroup>';
      if (sector !== '__none__') opts += `<optgroup label="${groups[sector] || sector}">`;
      lastSector = sector;
    }
    const sel = (a.key || 'none') === (currentRef || 'none') ? 'selected' : '';
    opts += `<option value="${a.key || 'none'}" ${sel}>${a.label}</option>`;
  }
  if (lastSector && lastSector !== '__none__') opts += '</optgroup>';

  testAgainstEl.innerHTML = `
    <label class="text-xs text-gray-400">Test Against</label>
    <select onchange="setBuilderReferenceAsset(this.value)" class="px-2 py-1 text-xs bg-gray-800/50 border border-gray-600/40 rounded text-gray-300 cursor-pointer">
      ${opts}
    </select>`;
}

function setBuilderReferenceAsset(key) {
  builderState.referenceAsset = key === 'none' ? null : key;
  updateBuilderChart();
}

// ── Builder Signal Sources (dynamic from sector registry) ─────────────────

function renderBuilderSignalSources() {
  const el = document.getElementById('builder-signal-sources');
  if (!el) return;

  const hasFG = sectorDataCache['crypto']?.refMap;
  if (!hasFG) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="flex items-center gap-2">
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" id="builder-fg-enabled" onchange="onBuilderControlChange()" class="rounded bg-gray-700 border-gray-600 text-green-500 w-3 h-3">
        <span class="text-[11px] text-gray-400">F&G Blend</span>
      </label>
      <div id="builder-fg-blend-wrap" class="hidden flex items-center gap-1.5">
        <input type="range" id="builder-fg-blend" min="5" max="95" value="30" step="5" oninput="onBuilderFgSliderChange()"
          class="w-16 h-1 rounded-full appearance-none cursor-pointer bg-gray-800 accent-green-500">
        <span id="builder-fg-blend-val" class="text-[10px] text-gray-500 tabular-nums w-6">30%</span>
      </div>
    </div>`;
}

// ── Builder Chart ───────────────────────────────────────────────────────────

function initBuilderChart() {
  if (builderState.chartInstance) {
    builderState.chartInstance.destroy();
    builderState.chartInstance = null;
  }

  const canvas = document.getElementById('builder-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const priceLabel = 'Reference';

  builderState.chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    plugins: [neutralLinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9ca3af',
            usePointStyle: true,
            pointStyle: 'line',
            padding: 16,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17,24,39,0.95)',
          titleColor: '#e5e7eb',
          bodyColor: '#9ca3af',
          borderColor: '#374151',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label(ctx) {
              const ds = ctx.dataset;
              const val = ctx.parsed.y;
              if (val == null) return null;
              if (ds.yAxisID === 'y2') {
                const meta = ALL_REFERENCE_ASSETS?.find(a => a.label === ds.label);
                const fmt = meta?.format || '$';
                if (fmt === '%') return `${ds.label}: ${val.toFixed(2)}%`;
                if (fmt === '$') return `${ds.label}: $${val.toLocaleString()}`;
                return `${ds.label}: ${val.toFixed(2)}`;
              }
              return `${ds.label}: ${val.toFixed(1)}/100`;
            },
          },
        },
      },
      scales: {
        y: {
          type: 'linear', position: 'left', min: 0, max: 100,
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#6b7280', font: { size: 11 } },
          title: { display: true, text: 'Indicator (0-100)', color: '#6b7280', font: { size: 11 } },
        },
        y2: {
          type: 'linear', position: 'right', display: true,
          grid: { display: false },
          ticks: {
            color: '#9ca3af', font: { size: 11 },
            callback: v => '$' + (v / 1000).toFixed(0) + 'K',
          },
          title: { display: true, text: priceLabel, color: '#9ca3af', font: { size: 11 } },
        },
        x: {
          grid: { display: false },
          ticks: { color: '#6b7280', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 12 },
        },
      },
    },
  });
}

function updateBuilderChart() {
  const chart = builderState.chartInstance;
  if (!chart) return;

  const ts = computeBuilderTimeseries();

  // Apply period filter
  const periodDays = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, 'ALL': Infinity };
  let startIdx = 0;
  if (builderState.chartPeriod === 'custom' && builderState.customPeriodStart) {
    startIdx = ts.dates.findIndex(d => d >= builderState.customPeriodStart);
    if (startIdx < 0) startIdx = 0;
    const endIdx = builderState.customPeriodEnd
      ? ts.dates.findIndex(d => d > builderState.customPeriodEnd)
      : ts.dates.length;
    // Slice to custom range
    if (endIdx > 0 && endIdx < ts.dates.length) {
      ts.dates = ts.dates.slice(0, endIdx);
      ts.scores = ts.scores.slice(0, endIdx);
      ts.prices = ts.prices.slice(0, endIdx);
      ts.fgValues = ts.fgValues.slice(0, endIdx);
    }
  } else {
    const days = periodDays[builderState.chartPeriod] || Infinity;
    if (days < Infinity && ts.dates.length > days) {
      startIdx = ts.dates.length - days;
    }
  }

  const slicedDates = ts.dates.slice(startIdx);
  const slicedScores = ts.scores.slice(startIdx);
  const slicedPrices = ts.prices.slice(startIdx);
  const slicedFg = ts.fgValues.slice(startIdx);

  const labels = slicedDates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const noPoints = slicedDates.length > 30;

  const datasets = [
    {
      label: 'Custom Indicator',
      data: slicedScores,
      borderColor: LINE_COLORS.composite.border,
      backgroundColor: LINE_COLORS.composite.bg,
      borderWidth: 2.5,
      fill: true,
      tension: 0.3,
      pointRadius: noPoints ? 0 : 3,
      pointHoverRadius: 6,
      yAxisID: 'y',
      spanGaps: false,
    },
  ];

  const refAssetKey = builderState.referenceAsset;
  const refAssetMeta = ALL_REFERENCE_ASSETS?.find(a => a.key === refAssetKey);
  const hasPrices = refAssetKey && slicedPrices.some(p => p != null);
  if (hasPrices) {
    const refLabel = refAssetMeta?.label || 'Reference';
    const refColors = LINE_COLORS[refAssetKey] || LINE_COLORS.btc_price;
    datasets.push({
      label: refLabel,
      data: slicedPrices,
      borderColor: refColors.border,
      backgroundColor: refColors.bg,
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'y2',
      spanGaps: true,
    });
  }

  if (builderState.fgEnabled) {
    datasets.push({
      label: 'Fear & Greed',
      data: slicedFg,
      borderColor: LINE_COLORS.fear_greed.border,
      backgroundColor: LINE_COLORS.fear_greed.bg,
      borderWidth: 1.5,
      borderDash: [3, 3],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'y',
      spanGaps: true,
    });
  }

  // Per-category lines (from selected markets)
  const _allCatMeta = {};
  for (const sId of SECTOR_ORDER) { const s = SECTORS[sId]; if (s?.categories) Object.assign(_allCatMeta, s.categories); }
  for (const cat of Object.keys(ts.catScores)) {
    if (ts.catScores[cat] && _allCatMeta[cat]) {
      datasets.push({
        label: _allCatMeta[cat].label,
        data: ts.catScores[cat].slice(startIdx),
        borderColor: LINE_COLORS[cat]?.border || '#6b7280',
        backgroundColor: LINE_COLORS[cat]?.bg || 'rgba(107,114,128,0.05)',
        borderWidth: 1.5,
        borderDash: [5, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        yAxisID: 'y',
        hidden: true,
        spanGaps: false,
      });
    }
  }

  chart.data.labels = labels;
  chart.data.datasets = datasets;

  if (hasPrices) {
    const prices = slicedPrices.filter(p => p != null);
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    const refFmt = refAssetMeta?.format || '$';
    // Smart padding and rounding based on value magnitude
    const range = pMax - pMin || 1;
    const pad = range * 0.1;
    if (refFmt === '%' || pMax < 100) {
      // Small values (rates, percentages, indices like VIX)
      const step = range < 2 ? 0.5 : range < 10 ? 1 : 5;
      chart.options.scales.y2.min = Math.floor((pMin - pad) / step) * step;
      chart.options.scales.y2.max = Math.ceil((pMax + pad) / step) * step;
    } else if (pMax < 1000) {
      chart.options.scales.y2.min = Math.floor((pMin - pad) / 10) * 10;
      chart.options.scales.y2.max = Math.ceil((pMax + pad) / 10) * 10;
    } else {
      chart.options.scales.y2.min = Math.floor((pMin - pad) / 1000) * 1000;
      chart.options.scales.y2.max = Math.ceil((pMax + pad) / 1000) * 1000;
    }
    chart.options.scales.y2.display = true;
    const refTitle = refAssetMeta?.label || 'Price (USD)';
    chart.options.scales.y2.title.text = refTitle;
    if (refFmt === '%') {
      chart.options.scales.y2.ticks.callback = v => v.toFixed(1) + '%';
    } else if (refFmt === '$') {
      chart.options.scales.y2.ticks.callback = v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0));
    } else {
      chart.options.scales.y2.ticks.callback = v => v.toFixed(1);
    }
  } else {
    chart.options.scales.y2.display = false;
  }

  chart.update('none');
  renderBuilderMetrics(ts);
}

function setBuilderChartPeriod(period, startDate, endDate) {
  builderState.chartPeriod = period;
  if (period === 'custom' && startDate && endDate) {
    builderState.customPeriodStart = startDate;
    builderState.customPeriodEnd = endDate;
  }
  document.querySelectorAll('[data-period]').forEach(btn => {
    const isActive = btn.dataset.period === period;
    btn.classList.toggle('text-blue-400', isActive);
    btn.classList.toggle('text-gray-500', !isActive);
  });
  updateBuilderChart();
}

function showCustomDateRange() {
  const start = prompt('Start date (YYYY-MM-DD):', '');
  if (!start) return;
  const end = prompt('End date (YYYY-MM-DD):', '');
  if (!end) return;
  setBuilderChartPeriod('custom', start, end);
}

// ── Builder Metrics ─────────────────────────────────────────────────────────

function renderBuilderMetrics(ts) {
  const el = document.getElementById('builder-metrics');
  if (!el) return;

  const corr = computeCorrelation(ts.scores, ts.prices);
  const dirAcc = computeDirectionalAccuracy(ts.scores, ts.prices);
  const predictive = computePredictiveScore(ts.scores, ts.prices);
  const lastScore = [...ts.scores].reverse().find(s => s != null);

  const corrColor = corr != null ? (Math.abs(corr) > 0.5 ? 'text-green-400' : Math.abs(corr) > 0.3 ? 'text-yellow-400' : 'text-gray-400') : 'text-gray-500';
  const scoreStr = lastScore != null ? lastScore.toFixed(1) : '--';
  const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(3) : '--';
  const dirStr = dirAcc != null ? dirAcc.toFixed(1) + '%' : '--';
  const predStr = predictive ? `${predictive.score}` : '--';
  const predColor = (!predictive || !predictive.significant) ? 'text-gray-500'
    : predictive.score >= 10 ? 'text-green-400'
    : predictive.score <= -10 ? 'text-red-400' : 'text-yellow-400';
  const lagStr = predictive ? `${predictive.optimalLag}d` : '';

  const mktCount = Object.keys(builderState.selectedMarkets).length;
  el.innerHTML = `
    <span class="text-lg font-semibold text-gray-100 tabular-nums">${scoreStr}</span>
    <span class="text-xs text-gray-500">${mktCount} markets</span>
    <span class="text-xs ${corrColor} tabular-nums">r=${corrStr}</span>
    <span class="text-xs text-gray-500 tabular-nums">${dirStr} dir</span>
    <span class="text-xs ${predColor} tabular-nums">pred=${predStr}</span>
    ${lagStr ? `<span class="text-xs text-gray-500 tabular-nums">lag ${lagStr}</span>` : ''}`;
}

// (Market browser removed — replaced by market picker in right panel)

// ── Builder Landing / Fork Picker ──────────────────────────────────────────

async function openForkIndicatorModal() {
  const modal = document.getElementById('fork-modal');
  const input = document.getElementById('fork-search');
  const results = document.getElementById('fork-results');
  if (!modal || !results) return;

  modal.classList.remove('hidden');
  if (input) input.value = '';
  results.innerHTML = '<div class="text-sm text-gray-500 py-8 text-center">Loading indicators...</div>';

  try {
    builderForkIndicators = await getIndicators();
  } catch (_) {
    builderForkIndicators = getIndicatorsSync();
  }

  renderForkIndicatorResults('');
  setTimeout(() => input?.focus(), 0);
}

function closeForkIndicatorModal() {
  document.getElementById('fork-modal')?.classList.add('hidden');
}

function renderForkIndicatorResults(query = '') {
  const results = document.getElementById('fork-results');
  if (!results) return;

  const q = query.trim().toLowerCase();
  const items = (builderForkIndicators.length ? builderForkIndicators : getIndicatorsSync())
    .filter(ind => canForkIndicator(ind))
    .filter(ind => {
      if (!q) return true;
      const sectorLabel = SECTORS[ind.sector || 'crypto']?.label || ind.sector || 'crypto';
      return [
        ind.name,
        ind.creator,
        ind.creatorName,
        ind.asset,
        ind.sector,
        sectorLabel,
      ].some(v => String(v || '').toLowerCase().includes(q));
    })
    .slice(0, 40);

  if (items.length === 0) {
    results.innerHTML = '<div class="text-sm text-gray-500 py-8 text-center">No matching indicators</div>';
    return;
  }

  results.innerHTML = items.map(ind => {
    const sector = ind.sector || 'crypto';
    const sectorLabel = SECTORS[sector]?.label || sector;
    const marketCount = getIndicatorMarketCount(ind);
    const categoryCount = ind.weights ? Object.entries(ind.weights).filter(([, v]) => Number(v) > 0).length : 0;
    const sourceCount = marketCount > 0
      ? `${marketCount} market${marketCount !== 1 ? 's' : ''}`
      : `${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`;
    const creator = ind.creator || ind.creatorName || (ind._isOwned ? 'You' : 'PMSI Team');
    const id = String(ind.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return `
      <button onclick="selectForkIndicator('${id}')" class="w-full text-left app-surface rounded-lg px-4 py-3 hover:border-green-500/40 transition-colors">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-100 truncate">${escapeHtml(ind.name || 'Untitled Indicator')}</div>
            <div class="mt-1 flex items-center gap-2 flex-wrap">
              <span class="text-[10px] text-gray-500">by ${escapeHtml(creator)}</span>
              <span class="sector-chip">${escapeHtml(sectorLabel)}</span>
              ${ind.asset ? `<span class="text-[10px] text-gray-500">${escapeHtml(ind.asset)}</span>` : ''}
              <span class="text-[10px] text-gray-500">${sourceCount}</span>
              ${ind.fgEnabled ? '<span class="text-[10px] text-green-500/80">F&G</span>' : ''}
            </div>
          </div>
          <span class="shrink-0 text-[11px] text-green-300 bg-green-500/10 border border-green-500/20 rounded-md px-2 py-1">Fork</span>
        </div>
      </button>`;
  }).join('');
}

function selectForkIndicator(id) {
  const ind = builderForkIndicators.find(i => i.id === id) || getIndicatorsSync().find(i => i.id === id);
  if (!ind) return;
  if (!canForkIndicator(ind)) { protectedForkMessage(); return; }
  closeForkIndicatorModal();
  forkFromData(ind, id);
}

// ── Save / Load ─────────────────────────────────────────────────────────────

async function saveBuilderIndicator() {
  const nameEl = document.getElementById('builder-name');
  const name = nameEl?.value?.trim();
  if (!name) {
    nameEl?.focus();
    nameEl?.classList.add('border-red-500/60');
    setTimeout(() => nameEl?.classList.remove('border-red-500/60'), 2000);
    return;
  }
  if (Object.keys(builderState.selectedMarkets).length === 0) return;

  const existing = builderState.editingId
    ? getIndicatorsSync().find(i => i.id === builderState.editingId)
    : null;

  const bp10 = parseFloat(document.getElementById('bp-10')?.value) || null;
  const bp50 = parseFloat(document.getElementById('bp-50')?.value) || null;
  const bp100 = parseFloat(document.getElementById('bp-100')?.value) || null;
  const bp500 = parseFloat(document.getElementById('bp-500')?.value) || null;

  // Client-side duplicate pre-check: compare market keys + fg config against owned indicators
  const ownedIndicators = getIndicatorsSync().filter(i => i._isOwned);
  const newMarkets = builderState.selectedMarkets;
  const newNormKeys = Object.keys(newMarkets).sort().join(',');
  for (const oi of ownedIndicators) {
    if (builderState.editingId && oi.id === builderState.editingId) continue;
    const oiMarkets = oi.markets || {};
    const oiKeys = Object.keys(oiMarkets).sort().join(',');
    if (oiKeys === newNormKeys && !!oi.fgEnabled === !!builderState.fgEnabled) {
      // Check if any weight differs by >= 1%
      let hasDiff = false;
      for (const k of Object.keys(newMarkets)) {
        const nw = typeof newMarkets[k] === 'object' ? (newMarkets[k].w ?? 100) : (newMarkets[k] || 100);
        const ow = typeof oiMarkets[k] === 'object' ? (oiMarkets[k].w ?? 100) : (oiMarkets[k] || 100);
        if (Math.abs(nw - ow) >= 1) { hasDiff = true; break; }
      }
      if (!hasDiff && !confirm(`This looks very similar to "${oi.name}". Save anyway?`)) return;
    }
  }

	  const indicator = {
	    id: builderState.editingId || generateId(),
	    name,
	    sector: builderState.targetSector === 'all' ? 'crypto' : (builderState.targetSector || 'crypto'),
	    asset: builderState.targetAsset || 'MIXED',
	    markets: { ...builderState.selectedMarkets },
    referenceAsset: builderState.referenceAsset,
    fgEnabled: builderState.fgEnabled,
    fgWeight: builderState.fgWeight,
    isPublic: true,
    bundlePrices: { 10: bp10, 50: bp50, 100: bp100, 500: bp500 },
    forkedFrom: builderState._pendingForkedFrom || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    _fromServer: !!existing?._fromServer,
  };

  await saveIndicatorToStorage(indicator);
  builderState.editingId = null;
  builderState.selectedMarkets = {};
  builderState.fgEnabled = false;
  builderState.fgWeight = 30;
  builderState.builderStarted = false;
  delete builderState._pendingForkedFrom;
  delete builderState._forkLoaded;
  delete builderState._pendingForkSource;

  location.hash = '#indicators';
}

function toggleBuilderLoadMenu() {
  const menu = document.getElementById('builder-load-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');

  if (isHidden) {
    const indicators = getIndicatorsSync();
    let html = '';

    if (indicators.length > 0) {
      html += '<div class="text-xs text-gray-500 px-3 py-1.5 uppercase tracking-wide">Saved Indicators</div>';
      for (const ind of indicators) {
        const mktCount = ind.markets ? Object.keys(ind.markets).length : 0;
        html += `<button onclick="loadBuilderIndicator('${ind.id}')" class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors">${ind.name} <span class="text-gray-500">${mktCount}m</span></button>`;
      }
    }

    if (!html) html = '<div class="px-3 py-2 text-sm text-gray-500">No saved indicators</div>';

    menu.innerHTML = html;
    menu.classList.remove('hidden');

    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target) && e.target.closest('.relative') !== menu.parentElement) {
          menu.classList.add('hidden');
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  } else {
    menu.classList.add('hidden');
  }
}

function loadBuilderIndicator(id) {
  const ind = getIndicatorsSync().find(i => i.id === id);
  if (!ind) return;

  builderState.builderStarted = true;
  builderState.editingId = id;
  setBuilderTargetFromIndicator(ind);
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  builderState.referenceAsset = ind.referenceAsset ?? builderState.referenceAsset ?? null;

  // Restore bundle prices
  const bp = ind.bundlePrices || {};
  const bp10El = document.getElementById('bp-10');
  const bp50El = document.getElementById('bp-50');
  const bp100El = document.getElementById('bp-100');
  const bp500El = document.getElementById('bp-500');
  if (bp10El) bp10El.value = bp[10] || '';
  if (bp50El) bp50El.value = bp[50] || '';
  if (bp100El) bp100El.value = bp[100] || '';
  if (bp500El) bp500El.value = bp[500] || '';

  if (ind.markets) {
    builderState.selectedMarkets = normalizeMarketConfig(ind.markets, ind.sector || 'crypto');
  } else if (ind.weights) {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset, ind.sector || 'crypto');
  }

  syncBuilderControls();
  renderBuilderTestAgainst();
  renderBuilderMarketPicker();
  updateBuilderChart();

  document.getElementById('builder-load-menu')?.classList.add('hidden');
}

// ═════════════════════════════════════════════════════════════════════════════
// INDICATOR COMPARISON (overlay 2-3 indicators on Indicators page)
// ═════════════════════════════════════════════════════════════════════════════

let comparisonState = {
  selected: new Set(),
  chartInstance: null,
};

function toggleCompareIndicator(id) {
  if (comparisonState.selected.has(id)) {
    comparisonState.selected.delete(id);
  } else {
    if (comparisonState.selected.size >= 3) return; // max 3
    comparisonState.selected.add(id);
  }
  updateComparisonUI();
}

function updateComparisonUI() {
  // Update checkbox states
  document.querySelectorAll('[data-compare-id]').forEach(cb => {
    cb.checked = comparisonState.selected.has(cb.dataset.compareId);
  });

  const panel = document.getElementById('comparison-panel');
  if (!panel) return;

  if (comparisonState.selected.size < 2) {
    panel.classList.add('hidden');
    if (comparisonState.chartInstance) {
      comparisonState.chartInstance.destroy();
      comparisonState.chartInstance = null;
    }
    return;
  }

  panel.classList.remove('hidden');
  renderComparisonChart();
}

async function renderComparisonChart() {
  const panel = document.getElementById('comparison-panel');
  if (!panel || comparisonState.selected.size < 2) return;

  const indicators = await getIndicators();
  const selected = indicators.filter(ind => comparisonState.selected.has(ind.id));

  const colors = ['#60a5fa', '#f97316', '#2dd4bf'];
  const allSeries = [];
  let commonDates = null;

  for (const ind of selected) {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    if (!sectorData) continue;
    const ts = computeIndicatorTimeseries(ind, sectorData);
    allSeries.push({ ind, ts });
    if (!commonDates) commonDates = ts.dates;
  }

  if (allSeries.length < 2 || !commonDates) return;

  const n = Math.min(90, commonDates.length);
  const startIdx = commonDates.length - n;
  const labels = commonDates.slice(startIdx).map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const datasets = allSeries.map((s, i) => ({
    label: s.ind.name,
    data: s.ts.scores.slice(startIdx),
    borderColor: colors[i % colors.length],
    borderWidth: 2,
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 5,
  }));

  const canvas = document.getElementById('comparison-chart');
  if (!canvas) return;

  if (comparisonState.chartInstance) comparisonState.chartInstance.destroy();

  comparisonState.chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    plugins: [neutralLinePlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', usePointStyle: true, pointStyle: 'line', font: { size: 11 } } },
        tooltip: { backgroundColor: 'rgba(17,24,39,0.95)', titleColor: '#e5e7eb', bodyColor: '#9ca3af', borderColor: '#374151', borderWidth: 1 },
      },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b7280' } },
        x: { grid: { display: false }, ticks: { color: '#6b7280', maxRotation: 0, maxTicksLimit: 10 } },
      },
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// BACKTEST PANEL
// ═════════════════════════════════════════════════════════════════════════════

function computeBacktest(dates, scores, prices, entryThreshold, exitThreshold, strategy, options = {}) {
  if (!scores || !prices || scores.length < 2) return null;
  const { costBps = 0 } = options;
  const halfCost = costBps / 20000; // half of round-trip bps as decimal

  // Find first index with both score and price for baseline
  const firstValidIdx = scores.findIndex((s, i) => s != null && prices[i] != null);
  if (firstValidIdx < 0) return null;
  const basePrice = prices[firstValidIdx];
  if (!basePrice || basePrice <= 0) return null;

  // Strategy-specific entry/exit conditions
  const shouldEnter = (score) => {
    if (strategy === 'contrarian' || strategy === 'long_only') return score <= entryThreshold;
    return score >= entryThreshold; // momentum
  };
  const shouldExit = (score) => {
    if (strategy === 'contrarian' || strategy === 'long_only') return score >= exitThreshold;
    return score <= exitThreshold; // momentum
  };
  const netTradeReturn = (exitPrice, entryPrice, exitCostPaid = true) => {
    if (!entryPrice || entryPrice <= 0) return 0;
    const exitCost = exitCostPaid ? (1 - halfCost) : 1;
    return (exitPrice / entryPrice) * (1 - halfCost) * exitCost - 1;
  };

  let position = false;
  let entryPrice = 0;
  let equity = 1;
  let maxEquity = 1;
  let maxDrawdown = 0;
  let wins = 0;
  let daysInPosition = 0;
  const equityCurve = [];
  const bhCurve = [];
  const dailyReturns = [];
  const tradeLog = [];
  let currentTrade = null;
  let prevEquity = 1;
  let totalDays = 0;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] == null || prices[i] == null) {
      equityCurve.push(equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : 1);
      bhCurve.push(bhCurve.length > 0 ? bhCurve[bhCurve.length - 1] : 1);
      continue;
    }
    totalDays++;

    // Update equity if in position (mark-to-market)
    if (position && entryPrice > 0) {
      const prevClose = i > 0 && prices[i - 1] != null ? prices[i - 1] : entryPrice;
      const dayPnl = (prices[i] - prevClose) / prevClose;
      equity *= (1 + dayPnl);
      daysInPosition++;
    }

    // Trading logic
    if (!position && shouldEnter(scores[i])) {
      position = true;
      entryPrice = prices[i];
      equity *= (1 - halfCost); // entry cost
      currentTrade = { entryIdx: i, entryDate: dates[i], entryPrice: prices[i], entryScore: scores[i] };
    } else if (position && shouldExit(scores[i])) {
      equity *= (1 - halfCost); // exit cost
      const grossPnl = (prices[i] - entryPrice) / entryPrice;
      const pnl = netTradeReturn(prices[i], entryPrice, true);
      if (pnl > 0) wins++;
      position = false;
      if (currentTrade) {
        currentTrade.exitIdx = i;
        currentTrade.exitDate = dates[i];
        currentTrade.exitPrice = prices[i];
        currentTrade.exitScore = scores[i];
        currentTrade.pnl = pnl;
        currentTrade.grossPnl = grossPnl;
        currentTrade.duration = i - currentTrade.entryIdx;
        tradeLog.push(currentTrade);
        currentTrade = null;
      }
    }

    if (equity > maxEquity) maxEquity = equity;
    const dd = (maxEquity - equity) / maxEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Track daily return for Sharpe/Sortino
    if (prevEquity > 0) dailyReturns.push(equity / prevEquity - 1);
    prevEquity = equity;

    equityCurve.push(equity);
    bhCurve.push(prices[i] / basePrice);
  }

  // Close open trade for logging (still in position at end)
  if (position && currentTrade) {
    const lastIdx = scores.length - 1;
    currentTrade.exitIdx = lastIdx;
    currentTrade.exitDate = dates[lastIdx];
    currentTrade.exitPrice = prices[lastIdx];
    currentTrade.exitScore = scores[lastIdx];
    currentTrade.pnl = netTradeReturn(prices[lastIdx], currentTrade.entryPrice, false);
    currentTrade.grossPnl = (prices[lastIdx] - currentTrade.entryPrice) / currentTrade.entryPrice;
    currentTrade.duration = lastIdx - currentTrade.entryIdx;
    currentTrade.open = true;
    tradeLog.push(currentTrade);
  }

  const totalReturn = equity - 1;
  const lastBh = bhCurve.length > 0 ? bhCurve[bhCurve.length - 1] - 1 : 0;

  // Annualized Sharpe (sqrt(252) * mean/stdev of daily returns)
  let sharpe = null;
  let sortino = null;
  if (dailyReturns.length > 10) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / dailyReturns.length;
    const stdev = Math.sqrt(variance);
    if (stdev > 0) sharpe = (mean / stdev) * Math.sqrt(252);

    // Sortino: only downside deviation
    const downReturns = dailyReturns.filter(r => r < 0);
    if (downReturns.length > 0) {
      const downVar = downReturns.reduce((a, r) => a + r * r, 0) / dailyReturns.length;
      const downDev = Math.sqrt(downVar);
      if (downDev > 0) sortino = (mean / downDev) * Math.sqrt(252);
    }
  }

  // CAGR
  let cagr = null;
  if (totalDays > 0) {
    cagr = (Math.pow(equity, 252 / totalDays) - 1) * 100;
  }

  // Profit factor
  let profitFactor = null;
  const closedTrades = tradeLog.filter(t => !t.open);
  const grossProfit = closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(closedTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  if (grossLoss > 0) profitFactor = grossProfit / grossLoss;

  // Avg trade PnL
  const avgTrade = closedTrades.length > 0 ? (closedTrades.reduce((s, t) => s + t.pnl, 0) / closedTrades.length) * 100 : 0;

  // Avg duration
  const avgDuration = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + t.duration, 0) / closedTrades.length : 0;

  // Exposure
  const exposure = totalDays > 0 ? (daysInPosition / totalDays) * 100 : 0;

  return {
    totalReturn: totalReturn * 100,
    maxDrawdown: maxDrawdown * 100,
    trades: closedTrades.length,
    winRate: closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0,
    buyHold: lastBh * 100,
    alpha: (totalReturn - lastBh) * 100,
    sharpe,
    sortino,
    cagr,
    profitFactor,
    avgTrade,
    avgDuration,
    exposure,
    equityCurve,
    bhCurve,
    tradeLog,
  };
}

// Backtest slider/input sync helpers
let _btDebounce = null;
function syncBtInput(which, val) {
  const numEl = document.getElementById(`bt-${which}`);
  if (numEl) numEl.value = val;
}
function onBtSliderInput(which, val) {
  syncBtInput(which, val);
  clearTimeout(_btDebounce);
  _btDebounce = setTimeout(() => renderBacktestPanel(), 250);
}
function syncBtSlider(which, val) {
  const sliderEl = document.getElementById(`bt-${which}-slider`);
  if (sliderEl) sliderEl.value = val;
}

let btStrategy = 'momentum';
const BT_STRATEGIES = {
  momentum:   { entryLabel: 'Enter above', exitLabel: 'Exit below',  hint: 'Buy high conviction, sell on doubt', defEntry: 60, defExit: 40 },
  contrarian: { entryLabel: 'Enter below', exitLabel: 'Exit above',  hint: 'Buy the dip, sell the rally', defEntry: 35, defExit: 65 },
  long_only:  { entryLabel: 'Enter below', exitLabel: 'Hold until',  hint: 'Buy cheap, hold for mean reversion', defEntry: 40, defExit: 55 },
};

function setBtStrategy(key) {
  btStrategy = key;
  const cfg = BT_STRATEGIES[key] || BT_STRATEGIES.momentum;
  // Update labels
  const entryLabel = document.getElementById('bt-entry-label');
  const exitLabel = document.getElementById('bt-exit-label');
  const hint = document.getElementById('bt-strat-hint');
  if (entryLabel) entryLabel.textContent = cfg.entryLabel;
  if (exitLabel) exitLabel.textContent = cfg.exitLabel;
  if (hint) hint.textContent = cfg.hint;
  // Update defaults
  syncBtInput('buy', cfg.defEntry); syncBtSlider('buy', cfg.defEntry);
  syncBtInput('sell', cfg.defExit); syncBtSlider('sell', cfg.defExit);
  // Update button styles
  for (const k of Object.keys(BT_STRATEGIES)) {
    const btn = document.getElementById(`bt-strat-${k}`);
    if (!btn) continue;
    if (k === key) {
      btn.className = 'px-2.5 py-1 text-[11px] bg-gray-800 text-gray-200 transition-colors';
    } else {
      btn.className = 'px-2.5 py-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors';
    }
  }
}

let btEquityChart = null;

function renderBacktestPanel() {
  const resultsEl = document.getElementById('bt-results');
  const equityWrap = document.getElementById('bt-equity-wrap');
  if (!resultsEl) return;

  const ts = computeBuilderTimeseries();
  const entryThreshold = parseInt(document.getElementById('bt-buy')?.value || '60');
  const exitThreshold = parseInt(document.getElementById('bt-sell')?.value || '40');

  const costBps = parseInt(document.getElementById('bt-cost-bps')?.value || '0');
  const result = computeBacktest(ts.dates, ts.scores, ts.prices, entryThreshold, exitThreshold, btStrategy, { costBps });
  if (!result) {
    resultsEl.innerHTML = '<span class="text-gray-500 text-xs">Insufficient data — need scores and a reference asset</span>';
    if (equityWrap) equityWrap.classList.add('hidden');
    return;
  }

  const retColor = result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400';
  const alphaColor = result.alpha >= 0 ? 'text-green-400' : 'text-red-400';
  const sharpeStr = result.sharpe != null ? result.sharpe.toFixed(2) : '--';
  const sortinoStr = result.sortino != null ? result.sortino.toFixed(2) : '--';
  const cagrStr = result.cagr != null ? `${result.cagr >= 0 ? '+' : ''}${result.cagr.toFixed(1)}%` : '--';
  const cagrColor = result.cagr != null && result.cagr >= 0 ? 'text-green-400' : (result.cagr != null ? 'text-red-400' : 'text-gray-200');
  const pfStr = result.profitFactor != null ? result.profitFactor.toFixed(2) : '--';
  const avgTradeStr = `${result.avgTrade >= 0 ? '+' : ''}${result.avgTrade.toFixed(1)}%`;
  const avgTradeColor = result.avgTrade >= 0 ? 'text-green-400' : 'text-red-400';

  const m = (label, value, color = 'text-gray-200', tip = '') =>
    `<div${tip ? ` class="bt-tip" data-tip="${tip}"` : ''}><div class="text-[11px] text-gray-400 uppercase tracking-wide">${label}</div><div class="${color} text-sm font-semibold tabular-nums">${value}</div></div>`;

  const pred = computePredictiveScore(ts.scores, ts.prices);
  const predStr = pred ? pred.score.toString() : '--';
  const predColor = pred ? (pred.score > 60 ? 'text-green-400' : pred.score > 40 ? 'text-yellow-400' : 'text-gray-200') : 'text-gray-200';
  const predLagStr = pred ? `${pred.optimalLag}d` : '--';

  resultsEl.innerHTML = `
    <div class="grid grid-cols-3 sm:grid-cols-5 gap-x-6 gap-y-3 mb-2">
      ${m('Return', `${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(1)}%`, retColor, 'Total strategy return. Net P&L from all trades over the backtest period.')}
      ${m('Buy & Hold', `${result.buyHold >= 0 ? '+' : ''}${result.buyHold.toFixed(1)}%`, 'text-gray-300', 'Benchmark return from holding the asset for the entire period with no trading.')}
      ${m('Alpha', `${result.alpha >= 0 ? '+' : ''}${result.alpha.toFixed(1)}%`, alphaColor, 'Excess return vs buy &amp; hold. Alpha = Strategy Return - Buy &amp; Hold Return.')}
      ${m('Sharpe', sharpeStr, 'text-gray-200', 'Risk-adjusted return. (Mean daily return / Std dev of daily returns) * sqrt(252). Above 1.0 is good, above 2.0 is excellent.')}
      ${m('Sortino', sortinoStr, 'text-gray-200', 'Like Sharpe but only penalizes downside volatility. Higher is better since it ignores upside variance.')}
    </div>
    <div class="grid grid-cols-4 sm:grid-cols-7 gap-x-6 gap-y-3">
      ${m('CAGR', cagrStr, cagrColor, 'Compound Annual Growth Rate. Annualized return accounting for compounding over the backtest period.')}
      ${m('Max DD', `\u2212${result.maxDrawdown.toFixed(1)}%`, 'text-red-400', 'Maximum drawdown. Largest peak-to-trough decline in portfolio value during the backtest.')}
      ${m('Win Rate', `${result.winRate.toFixed(0)}%`, 'text-gray-200', 'Percentage of trades that were profitable. Win Rate = Winning Trades / Total Trades.')}
      ${m('Profit Factor', pfStr, 'text-gray-200', 'Gross profit / Gross loss. Above 1.0 means profitable overall. Above 2.0 is strong.')}
      ${m('Trades', result.trades, 'text-gray-200', 'Total number of completed round-trip trades (entry + exit) during the backtest.')}
      ${m('Predictive', predStr, predColor, 'Predictive score (0-100). Measures how well this indicator leads future returns via lagged cross-correlation.')}
      ${m('Peak Lag', predLagStr, 'text-gray-200', 'Optimal lag in days where the indicator best predicts future price movement.')}
    </div>`;

  // Render trade log
  renderTradeLog(result.tradeLog);

  // Equity curve
  if (equityWrap && result.equityCurve && result.equityCurve.length > 1) {
    equityWrap.classList.remove('hidden');
    _renderEquityCurve(result.equityCurve, result.bhCurve, ts.dates);
  } else if (equityWrap) {
    equityWrap.classList.add('hidden');
  }
}

function renderTradeLog(tradeLog) {
  const container = document.getElementById('bt-trade-log');
  if (!container) return;
  if (!tradeLog || tradeLog.length === 0) {
    container.classList.add('hidden');
    return;
  }
  // Keep visibility state from toggle button
  const closedTrades = tradeLog.filter(t => !t.open);
  const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = closedTrades.length > 0 ? (totalPnl / closedTrades.length) * 100 : 0;
  const avgDur = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + t.duration, 0) / closedTrades.length : 0;
  const openCount = tradeLog.length - closedTrades.length;
  const tradeCountLabel = `${closedTrades.length} closed${openCount ? `, ${openCount} open` : ''}`;
  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--';
  const fmtPnl = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
  const pnlColor = v => v >= 0 ? 'text-green-400' : 'text-red-400';
  const rowBg = v => v >= 0 ? 'bg-green-500/5' : 'bg-red-500/5';

  const rows = tradeLog.slice(0, 50).map((t, idx) => `
    <tr class="${rowBg(t.pnl)}">
      <td class="px-3 py-1.5 text-gray-500">${idx + 1}</td>
      <td class="px-3 py-1.5">${fmtDate(t.entryDate)}</td>
      <td class="px-3 py-1.5">${fmtDate(t.exitDate)}${t.open ? ' *' : ''}</td>
      <td class="px-3 py-1.5 tabular-nums">$${t.entryPrice?.toFixed(2)}</td>
      <td class="px-3 py-1.5 tabular-nums">$${t.exitPrice?.toFixed(2)}</td>
      <td class="px-3 py-1.5 tabular-nums ${pnlColor(t.pnl)}">${fmtPnl(t.pnl)}</td>
      <td class="px-3 py-1.5 tabular-nums">${t.duration}d</td>
      <td class="px-3 py-1.5 tabular-nums text-gray-500">${t.entryScore?.toFixed(0)}\u2192${t.exitScore?.toFixed(0)}</td>
    </tr>`).join('');

  container.innerHTML = `
    <table class="w-full text-xs text-gray-300 border-collapse">
      <thead><tr class="text-[11px] text-gray-400 uppercase tracking-wide border-b border-gray-700/30">
        <th class="px-3 py-1.5 text-left">#</th>
        <th class="px-3 py-1.5 text-left">Entry</th>
        <th class="px-3 py-1.5 text-left">Exit</th>
        <th class="px-3 py-1.5 text-left">Entry $</th>
        <th class="px-3 py-1.5 text-left">Exit $</th>
        <th class="px-3 py-1.5 text-left">PnL</th>
        <th class="px-3 py-1.5 text-left">Dur</th>
        <th class="px-3 py-1.5 text-left">Score</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="border-t border-gray-700/30 text-gray-400 font-medium">
        <td class="px-3 py-1.5" colspan="4">${tradeCountLabel}</td>
        <td class="px-3 py-1.5"></td>
        <td class="px-3 py-1.5 tabular-nums ${pnlColor(avgPnl / 100)}">${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(1)}%</td>
        <td class="px-3 py-1.5 tabular-nums">${avgDur.toFixed(0)}d</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function toggleTradeLog() {
  const el = document.getElementById('bt-trade-log');
  const btn = document.getElementById('bt-trade-toggle');
  if (!el) return;
  el.classList.toggle('hidden');
  if (btn) btn.textContent = el.classList.contains('hidden') ? 'Show Trades' : 'Hide Trades';
}

function _renderEquityCurve(equity, bh, dates) {
  const canvas = document.getElementById('bt-equity-chart');
  if (!canvas) return;
  if (btEquityChart) btEquityChart.destroy();

  const labels = dates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  btEquityChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Strategy', data: equity, borderColor: '#60a5fa', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'Buy & Hold', data: bh, borderColor: 'rgba(156,163,175,0.4)', borderWidth: 1, borderDash: [3, 3], fill: false, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', usePointStyle: true, pointStyle: 'line', font: { size: 10 } } },
        tooltip: {
          backgroundColor: 'rgba(17,24,39,0.95)', titleColor: '#e5e7eb', bodyColor: '#9ca3af',
          borderColor: '#374151', borderWidth: 1, padding: 8,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${((ctx.parsed.y - 1) * 100).toFixed(1)}%` },
        },
      },
      scales: {
        x: { display: false },
        y: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#6b7280', font: { size: 10 }, callback: v => ((v - 1) * 100).toFixed(0) + '%' },
        },
      },
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ALERT MODAL
// ═════════════════════════════════════════════════════════════════════════════

function openAlertModal(indicatorId, indicatorName) {
  if (!authState.token) {
    openAuthModal();
    return;
  }
  document.getElementById('alert-indicator-id').value = indicatorId;
  document.getElementById('alert-indicator-name').textContent = indicatorName;
  document.getElementById('alert-error').textContent = '';
  document.getElementById('alert-modal').classList.remove('hidden');
}

function closeAlertModal() {
  document.getElementById('alert-modal').classList.add('hidden');
}

function toggleAlertThreshold() {
  const cond = document.getElementById('alert-condition').value;
  const wrap = document.getElementById('alert-threshold-wrap');
  if (wrap) wrap.style.display = cond === 'daily_summary' ? 'none' : 'block';
}

async function createAlert() {
  const indicatorId = document.getElementById('alert-indicator-id').value;
  const condition = document.getElementById('alert-condition').value;
  const threshold = parseFloat(document.getElementById('alert-threshold').value);
  const channel = document.getElementById('alert-channel').value;
  const destination = document.getElementById('alert-destination').value.trim();
  const errEl = document.getElementById('alert-error');

  if (!destination) {
    errEl.textContent = 'Destination is required';
    return;
  }

  try {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        indicatorId,
        condition,
        threshold: condition === 'daily_summary' ? null : threshold,
        channel,
        destination,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      errEl.textContent = data.error || 'Failed to create alert';
      return;
    }

    closeAlertModal();
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
  }
}
