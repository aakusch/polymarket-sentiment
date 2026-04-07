// ── Indicators & Builder — Multi-Sector Polymarket Indicators ────────────────

// ── Builder State ───────────────────────────────────────────────────────────

let builderState = {
  chartInstance: null,
  selectedMarkets: {},  // { marketId: { w: weight, flip: bool } }
  fgEnabled: false,
  fgWeight: 30,
  chartPeriod: 'ALL',
  editingId: null,
  initialized: false,
  marketSearch: '',     // search filter text
  referenceAsset: null, // "Test Against" — key from ALL_REFERENCE_ASSETS (e.g. 'btc_price', 'spx_price', null)
};

let sparklineCharts = [];

// ── Indicator CRUD (API when authed, localStorage fallback) ─────────────────

let _indicatorCache = null;

function _mergeWithDemos(userIndicators) {
  // Always include demo indicators for sectors the user hasn't built their own
  const ids = new Set(userIndicators.map(i => i.id));
  const merged = [...userIndicators];
  for (const demo of DEMO_INDICATORS) {
    if (!ids.has(demo.id)) merged.push(demo);
  }
  return merged;
}

async function getIndicators() {
  if (authState.token) {
    if (_indicatorCache) return _indicatorCache;
    try {
      const res = await fetch('/api/indicators', { headers: authHeaders() });
      if (res.ok) {
        const items = await res.json();
        if (items.length > 0) {
          _indicatorCache = _mergeWithDemos(items);
          return _indicatorCache;
        }
      }
    } catch (e) { console.error('Failed to fetch indicators:', e); }
  }
  const local = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  return _mergeWithDemos(local);
}

// Sync version for non-async callers (builder load menu, edit, etc.)
function getIndicatorsSync() {
  if (_indicatorCache) return _indicatorCache;
  const local = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  return _mergeWithDemos(local);
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

// ── Demo Indicators (seed localStorage if empty) ─────────────────────────

const DEMO_INDICATORS = [
  {
    id: 'demo_btc_core', name: 'BTC Core Targets', sector: 'crypto', asset: 'BTC',
    markets: {
      '701491': 150, '701490': 140, '701489': 120, '701493': 130,
      '701494': 110, '701495': 100, '701496': 80,
      '701501': 60, '701502': 50, '701503': 40,
      '516926': 80, '692258': 70, '824952': 60,
      '512250': 90, '1144471': 50,
    },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:00:00Z',
  },
  {
    id: 'demo_btc_fg', name: 'BTC Contrarian F&G', sector: 'crypto', asset: 'BTC',
    markets: {
      '701491': 120, '701490': 100, '701493': 100, '701495': 80,
      '701496': 60, '701500': 80, '701499': 70,
      '1057883': 40, '701486': 50, '701488': 60,
      '516926': 100, '512250': 80,
    },
    fgEnabled: true, fgWeight: 55, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:01:00Z',
  },
  {
    id: 'demo_btc_dip', name: 'BTC Dip Monitor', sector: 'crypto', asset: 'BTC',
    markets: {
      '701503': 200, '701504': 180, '701502': 180, '701501': 160,
      '701500': 140, '701499': 120,
      '1339768': 100, '1339769': 90, '1343219': 80,
      '1343220': 60, '1343228': 40, '1057916': 50,
      '701491': 30, '701486': 20,
    },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:02:00Z',
  },
  {
    id: 'demo_eth_price', name: 'ETH Price Composite', sector: 'crypto', asset: 'ETH',
    markets: {
      '578092': 120, '251855': 150, '1076131': 100, '1076132': 80,
      '1076110': 90, '1076108': 70, '1076111': 60,
      '1473059': 100, '253520': 40, '1168516': 30, '1693675': 50,
    },
    fgEnabled: true, fgWeight: 25, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:03:00Z',
  },
  {
    id: 'demo_btc_ladder', name: 'BTC Milestone Ladder', sector: 'crypto', asset: 'BTC',
    markets: {
      '1345529': 100, '1345530': 100, '1345531': 100,
      '701496': 100, '701495': 100, '701494': 100, '701493': 100,
      '701492': 100, '701491': 100, '701490': 100, '701489': 100,
      '701488': 100, '701487': 100, '701486': 100, '1057883': 100,
    },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:04:00Z',
  },
  // ── Stocks demos ──────────────────────────────────────────
  {
    id: 'demo_spx_sentiment', name: 'S&P 500 Sentiment', sector: 'stocks', asset: 'SPX',
    weights: { price_targets: 100, earnings: 80, corporate: 60 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:05:00Z',
  },
  {
    id: 'demo_tech_pulse', name: 'Tech Mega-Cap Pulse', sector: 'stocks', asset: 'NDX',
    weights: { price_targets: 150, earnings: 150, corporate: 40 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:06:00Z',
  },
  {
    id: 'demo_earnings_signal', name: 'Earnings Season Signal', sector: 'stocks', asset: 'SPX',
    weights: { price_targets: 40, earnings: 200, corporate: 80 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:07:00Z',
  },
  // ── Economy demos ─────────────────────────────────────────
  {
    id: 'demo_fed_outlook', name: 'Fed Policy Outlook', sector: 'economy', asset: 'FED',
    weights: { monetary_policy: 200, inflation: 80, growth: 40, employment: 40 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:08:00Z',
  },
  {
    id: 'demo_recession_watch', name: 'Recession Watch', sector: 'economy', asset: 'GDP',
    weights: { monetary_policy: 60, inflation: 60, growth: 200, employment: 150 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:09:00Z',
  },
  {
    id: 'demo_macro_index', name: 'Macro Sentiment Index', sector: 'economy', asset: 'FED',
    weights: { monetary_policy: 100, inflation: 100, growth: 100, employment: 100 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:10:00Z',
  },
  // ── Politics demos ────────────────────────────────────────
  {
    id: 'demo_election_barometer', name: 'Election Barometer', sector: 'politics', asset: 'GOP',
    weights: { favors_incumbent: 150, favors_challenger: 150, legislative: 30, judicial: 20, geopolitical: 20 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:11:00Z',
  },
  {
    id: 'demo_policy_impact', name: 'Policy Impact Index', sector: 'politics', asset: 'SENATE',
    weights: { favors_incumbent: 30, favors_challenger: 30, legislative: 150, judicial: 100, geopolitical: 100 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:12:00Z',
  },
  {
    id: 'demo_political_sentiment', name: 'Political Sentiment', sector: 'politics', asset: 'DEM',
    weights: { favors_incumbent: 100, favors_challenger: 100, legislative: 80, judicial: 60, geopolitical: 60 },
    fgEnabled: false, fgWeight: 30, isPublic: true, pricePer100: null,
    createdAt: '2026-04-03T12:13:00Z',
  },
];

function seedDemoIndicators() {
  const existing = JSON.parse(localStorage.getItem('pcsi_indicators') || '[]');
  if (existing.length > 0) return;
  localStorage.setItem('pcsi_indicators', JSON.stringify(DEMO_INDICATORS));
}

// ── Core Computation ─────────────────────────────────────────────────────

function computeIndicatorTimeseries(config, sectorData) {
  const priceKey = config.referenceAsset || 'btc_price';
  const fgKey = 'fear_greed';
  // Get refMap from the appropriate sector cache
  const refAssetMeta = typeof ALL_REFERENCE_ASSETS !== 'undefined' ? ALL_REFERENCE_ASSETS.find(a => a.key === priceKey) : null;
  const refSectorId = refAssetMeta?.sector || 'crypto';
  const refMap = sectorDataCache[refSectorId]?.refMap || sectorData?.refMap || {};

  const isMarketMode = !!config.markets && Object.keys(config.markets).length > 0;

  if (isMarketMode) {
    // Build per-market lookups across all sector caches (markets can come from anywhere)
    const marketLookups = {};
    const allDatesSet = new Set();

    for (const mid of Object.keys(config.markets)) {
      for (const sId of SECTOR_ORDER) {
        const ssd = sectorDataCache[sId];
        if (!ssd?.sandbox?.assets) continue;
        for (const [asset, ad] of Object.entries(ssd.sandbox.assets)) {
          if (ad.markets?.[mid]) {
            const m = ad.markets[mid];
            const ssMap = {}, wtMap = {};
            for (let i = 0; i < ad.dates.length; i++) {
              ssMap[ad.dates[i]] = m.ss[i];
              wtMap[ad.dates[i]] = m.wt[i];
              allDatesSet.add(ad.dates[i]);
            }
            marketLookups[mid] = { ssMap, wtMap, cat: m.cat };
            break;
          }
        }
        if (marketLookups[mid]) break;
      }
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
  const sector = SECTORS[config.sector || 'crypto'];
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
  const marketLookups = {};
  const allDatesSet = new Set();

  for (const mid of Object.keys(selectedMarkets)) {
    for (const sId of SECTOR_ORDER) {
      const ssd = sectorDataCache[sId];
      if (!ssd?.sandbox?.assets) continue;
      for (const [asset, ad] of Object.entries(ssd.sandbox.assets)) {
        if (ad.markets?.[mid]) {
          const m = ad.markets[mid];
          const ssMap = {}, wtMap = {};
          for (let i = 0; i < ad.dates.length; i++) {
            ssMap[ad.dates[i]] = m.ss[i];
            wtMap[ad.dates[i]] = m.wt[i];
            allDatesSet.add(ad.dates[i]);
          }
          marketLookups[mid] = { ssMap, wtMap, cat: m.cat };
          break;
        }
      }
      if (marketLookups[mid]) break;
    }
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
        const sign = isMarketFlipped(cfg) ? -1 : 1;
        cNum += sign * ss * wt;
        cDen += wt;
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

let indicatorViewMode = 'table'; // 'table' | 'card'
function setIndicatorView(mode) {
  indicatorViewMode = mode;
  document.getElementById('ind-view-table')?.classList.toggle('bg-gray-800', mode === 'table');
  document.getElementById('ind-view-table')?.classList.toggle('text-gray-200', mode === 'table');
  document.getElementById('ind-view-table')?.classList.toggle('text-gray-500', mode !== 'table');
  document.getElementById('ind-view-card')?.classList.toggle('bg-gray-800', mode === 'card');
  document.getElementById('ind-view-card')?.classList.toggle('text-gray-200', mode === 'card');
  document.getElementById('ind-view-card')?.classList.toggle('text-gray-500', mode !== 'card');
  renderIndicatorsPage();
}

async function renderIndicatorsPage() {
  const container = document.getElementById('indicators-sectors');
  if (!container) return;

  // Destroy old sparklines
  sparklineCharts.forEach(c => c.destroy());
  sparklineCharts = [];

  const indicators = await getIndicators();

  // Load data for all sectors that have indicators
  const allSectors = new Set(indicators.map(i => i.sector || 'crypto'));
  const loadPromises = [...allSectors].filter(s => SECTORS[s]?.available).map(s => loadSectorData(s));
  await Promise.all(loadPromises);

  const filtered = indicators;

  // Compute stats for each indicator
  const ranked = filtered.map(ind => {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    if (sectorData) {
      const ts = computeIndicatorTimeseries(ind, sectorData);
      const corr = computeCorrelation(ts.scores, ts.prices);
      const dirAcc = computeDirectionalAccuracy(ts.scores, ts.prices);
      const deltas = computePeriodDeltas(ts.scores, ts.dates);
      const lastScore = [...ts.scores].reverse().find(s => s != null);
      return { ind, ts, corr, dirAcc, deltas, lastScore };
    }
    return { ind, ts: { dates: [], scores: [], prices: [] }, corr: null, dirAcc: null, deltas: {}, lastScore: null };
  });

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
      case 'newest':
        return (b.ind.createdAt || '').localeCompare(a.ind.createdAt || '');
      case 'name':
        return (a.ind.name || '').localeCompare(b.ind.name || '');
      default:
        return 0;
    }
  });

  if (ranked.length === 0) {
    container.innerHTML = `
      <div class="bg-gray-900/50 rounded-2xl p-8 border border-gray-800/50 text-center">
        <div class="text-gray-400 mb-2">No indicators yet</div>
        <p class="text-gray-500 text-sm mb-4">Build your first indicator to get started.</p>
        <a href="#builder" class="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">Build &rarr;</a>
      </div>`;
    return;
  }

  if (indicatorViewMode === 'card') {
    container.innerHTML = renderIndicatorCards(ranked);
  } else {
    container.innerHTML = renderIndicatorTableUnified(ranked);
  }

  // Render sparklines after DOM update
  requestAnimationFrame(async () => {
    const indicators = await getIndicators();
    for (const ind of indicators) {
      const sectorData = sectorDataCache[ind.sector || 'crypto'];
      if (!sectorData) continue;
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

function renderIndicatorTableUnified(ranked) {
  let html = `
    <div class="bg-gray-900/50 rounded-xl border border-gray-800/50 overflow-hidden">
      <table class="ind-table text-xs">
        <thead>
          <tr class="border-b border-gray-800/50 text-gray-500 font-medium">
            <th class="py-2.5 px-2 pl-4 w-7"></th>
            <th class="py-2.5 px-2 w-20">Chart</th>
            <th class="py-2.5 px-2">Indicator</th>
            <th class="py-2.5 px-2 w-14 text-center">Score</th>
            <th class="py-2.5 px-2 w-12 text-center hidden sm:table-cell">Corr</th>
            <th class="py-2.5 px-2 w-14 text-center hidden lg:table-cell">Dir Acc</th>
            <th class="py-2.5 px-2 w-11 text-center hidden sm:table-cell">7d</th>
            <th class="py-2.5 px-2 w-11 text-center hidden md:table-cell">30d</th>
            <th class="py-2.5 px-2 pr-4 w-20 text-right"></th>
          </tr>
        </thead>
        <tbody>`;

  for (const { ind, corr, dirAcc, deltas, lastScore } of ranked) {
    const scoreStr = lastScore != null ? lastScore.toFixed(1) : '--';
    const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
    const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '--';
    const corrClr = corr != null ? (Math.abs(corr) > 0.5 ? '#4ade80' : Math.abs(corr) > 0.3 ? '#fbbf24' : '#9ca3af') : '#4b5563';
    const dirAccStr = dirAcc != null ? dirAcc.toFixed(0) + '%' : '--';
    const dirAccClr = dirAcc != null ? (dirAcc > 55 ? '#4ade80' : dirAcc > 50 ? '#fbbf24' : '#9ca3af') : '#4b5563';
    const escapedName = ind.name.replace(/'/g, "\\'");
    const marketCount = ind.markets ? Object.keys(ind.markets).length : 0;

    html += `
          <tr class="group">
            <td class="py-2.5 px-2 pl-4 align-middle">
              <input type="checkbox" data-compare-id="${ind.id}" onchange="toggleCompareIndicator('${ind.id}')"
                class="w-3 h-3 rounded cursor-pointer" style="accent-color:#60a5fa">
            </td>
            <td class="py-2.5 px-2 align-middle">
              <div class="h-7 w-[72px]"><canvas id="spark-${ind.id}"></canvas></div>
            </td>
            <td class="py-2.5 px-2 align-middle">
              <div class="text-[13px] text-gray-200 font-medium leading-tight">${ind.name}</div>
              <div class="text-[10px] text-gray-600 mt-0.5">
                ${marketCount > 0 ? marketCount + 'm' : ''}${ind.fgEnabled ? ' <span class="text-green-500">F&G</span>' : ''}
              </div>
            </td>
            <td class="py-2.5 px-2 text-center align-middle">
              <span class="text-sm font-semibold tabular-nums" style="color:${sColor}">${scoreStr}</span>
            </td>
            <td class="py-2.5 px-2 text-center align-middle tabular-nums hidden sm:table-cell" style="color:${corrClr}">${corrStr}</td>
            <td class="py-2.5 px-2 text-center align-middle tabular-nums hidden lg:table-cell" style="color:${dirAccClr}">${dirAccStr}</td>
            <td class="py-2.5 px-2 text-center align-middle tabular-nums hidden sm:table-cell">${fmtDelta(deltas['1W'])}</td>
            <td class="py-2.5 px-2 text-center align-middle tabular-nums hidden md:table-cell">${fmtDelta(deltas['1M'])}</td>
            <td class="py-2.5 px-2 pr-4 text-right align-middle">
              <span class="inline-flex gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                <button onclick="openAlertModal('${ind.id}','${escapedName}')" class="p-1 text-gray-400 hover:text-blue-400 transition-colors" title="Alert">&#128276;</button>
                <button onclick="editIndicator('${ind.id}')" class="p-1 text-gray-400 hover:text-blue-400 transition-colors" title="Edit">&#9998;</button>
                <button onclick="confirmDeleteIndicator('${ind.id}')" class="p-1 text-gray-400 hover:text-red-400 transition-colors" title="Delete">&times;</button>
              </span>
            </td>
          </tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

function renderIndicatorCards(ranked) {
  let html = '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">';
  for (const { ind, corr, dirAcc, deltas, lastScore } of ranked) {
    const scoreStr = lastScore != null ? lastScore.toFixed(1) : '--';
    const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
    const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '--';
    const marketCount = ind.markets ? Object.keys(ind.markets).length : 0;
    const escapedName = ind.name.replace(/'/g, "\\'");
    const label = lastScore != null ? scoreLabel(lastScore) : '';
    const d7 = deltas['1W'];
    const d7Str = d7 != null ? (d7 > 0 ? '+' : '') + d7.toFixed(1) : '--';
    const d7Color = d7 > 0 ? 'text-green-400' : d7 < 0 ? 'text-red-400' : 'text-gray-500';

    html += `
      <div class="group bg-gray-900/50 rounded-xl border border-gray-800/50 hover:border-gray-700/50 transition-all hover:bg-gray-900/70 overflow-hidden">
        <div class="p-4 pb-2">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0 mr-3">
              <div class="text-sm font-medium text-gray-200 truncate">${ind.name}</div>
              <div class="text-[10px] text-gray-600 mt-0.5">${marketCount}m${ind.fgEnabled ? ' <span class="text-green-500">F&G</span>' : ''}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xl font-bold tabular-nums" style="color:${sColor}">${scoreStr}</div>
              <div class="text-[10px] text-gray-500">${label}</div>
            </div>
          </div>
        </div>
        <div class="px-4 h-10"><canvas id="spark-${ind.id}"></canvas></div>
        <div class="flex items-center justify-between px-4 py-2.5 mt-1 border-t border-gray-800/30">
          <div class="flex gap-3 text-[11px] text-gray-500 tabular-nums">
            <span>r=${corrStr}</span>
            <span class="${d7Color}">7d: ${d7Str}</span>
          </div>
          <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="editIndicator('${ind.id}')" class="p-1 text-gray-500 hover:text-blue-400 transition-colors text-xs" title="Edit">&#9998;</button>
            <button onclick="confirmDeleteIndicator('${ind.id}')" class="p-1 text-gray-500 hover:text-red-400 transition-colors text-xs" title="Delete">&times;</button>
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  return html;
}

async function editIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (!ind) return;
  builderState.editingId = id;
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  builderState.referenceAsset = ind.referenceAsset || null;
  builderState._pendingName = ind.name || '';
  location.hash = '#builder?id=' + id;
}

async function confirmDeleteIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (ind && confirm(`Delete "${ind.name}"?`)) {
    await deleteIndicator(id);
    renderIndicatorsPage();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE 2: BUILDER (Sector-aware)
// ═════════════════════════════════════════════════════════════════════════════

async function renderBuilderPage() {
  const hash = location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const editId = params.get('id');

  // If editing, load from indicator
  if (editId && editId !== builderState.editingId) {
    builderState.editingId = editId;
    const ind = (await getIndicators()).find(i => i.id === editId);
    if (ind) {
      builderState.fgEnabled = ind.fgEnabled || false;
      builderState.fgWeight = ind.fgWeight || 30;
      builderState.referenceAsset = ind.referenceAsset || null;
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
        builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset);
      }
    }
  }

  renderBuilderMarketPicker();
  renderBuilderTestAgainst();
  renderBuilderSignalSources();
  syncBuilderControls();

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
      out[mid] = { w: val, flip: false };
    } else if (typeof val === 'object' && val !== null) {
      out[mid] = { w: val.w ?? val.weight ?? 100, flip: !!val.flip };
    } else {
      out[mid] = { w: 100, flip: false };
    }
  }
  return out;
}

// Migrate legacy category weights to per-market selection
function migrateWeightsToMarkets(weights, includeOther, sectorData, asset) {
  const assetData = sectorData?.sandbox?.assets?.[asset];
  if (!assetData?.markets) return {};
  const selected = {};
  for (const [mid, m] of Object.entries(assetData.markets)) {
    const catWeight = weights[m.cat];
    if (catWeight != null && catWeight > 0) {
      selected[mid] = { w: catWeight, flip: false };
    } else if (m.cat === 'other' && includeOther && (weights.other || 0) > 0) {
      selected[mid] = { w: weights.other, flip: false };
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

function _filterAndSortMarkets(all) {
  const search = builderState.marketSearch.toLowerCase();
  const hideExpired = document.getElementById('builder-hide-expired')?.checked ?? true;
  const hideResolved = document.getElementById('builder-hide-resolved')?.checked ?? true;
  const sortBy = document.getElementById('builder-market-sort')?.value || 'volume';
  const today = new Date().toISOString().slice(0, 10);

  let filtered = all;
  if (search) filtered = filtered.filter(m => m.q.toLowerCase().includes(search));
  if (hideExpired) filtered = filtered.filter(m => !m.end || m.end >= today);
  if (hideResolved) filtered = filtered.filter(m => m.prob == null || (m.prob > 0.02 && m.prob < 0.98));

  switch (sortBy) {
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
      <div class="text-xs text-gray-500">No markets selected</div>
      <div class="text-[10px] text-gray-600 mt-0.5">Check markets below to build</div>
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
          <span class="text-[10px] text-gray-600 w-2.5">${collapsed ? '▸' : '▾'}</span>
          <span class="text-[11px] font-medium" style="color:${meta.accent}">${meta.label}</span>
          <span class="text-[10px] text-gray-600 tabular-nums">${selectedInCat.length}/${list.length}</span>
        </div>
        <div class="flex gap-1.5 opacity-0 group-hover/cat:opacity-100 transition-opacity" onclick="event.stopPropagation()">
          <button onclick="selectAllMarketsInCat('${cat}',true)" class="text-[10px] text-gray-600 hover:text-gray-300 transition-colors">All</button>
          <button onclick="selectAllMarketsInCat('${cat}',false)" class="text-[10px] text-gray-600 hover:text-gray-300 transition-colors">None</button>
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
          : 'border-transparent hover:bg-gray-800/30';

        html += `
          <div class="flex items-start gap-2 py-1 px-1.5 rounded border ${selectedBg} transition-colors group/row cursor-pointer" onclick="toggleMarketFromRow('${m.mid}', event)">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleMarket('${m.mid}', this.checked); event.stopPropagation()"
              class="rounded bg-gray-700 border-gray-600 w-3 h-3 shrink-0 cursor-pointer mt-0.5" style="accent-color:${meta.accent}">
            <div class="flex-1 min-w-0">
              <div class="text-[11px] leading-tight ${isSelected ? 'text-gray-200' : 'text-gray-400'}" title="${m.q}">
                ${flipped ? '<span class="text-red-400 font-medium mr-0.5" title="Inverted signal">&minus;</span>' : ''}${m.q}
              </div>
              <div class="flex items-center gap-2 mt-0.5 text-[9px] text-gray-600">
                ${probPct != null ? `<span class="tabular-nums">${probPct}%</span>` : ''}
                ${volStr ? `<span>${volStr}</span>` : ''}
                ${endShort ? `<span>${endShort}</span>` : ''}
              </div>
            </div>
            ${isSelected ? `
              <div class="flex items-center gap-1 shrink-0 mt-0.5">
                <button onclick="toggleMarketFlip('${m.mid}', event)" title="${flipped ? 'Signal inverted (click to restore)' : 'Invert signal (bearish)'}"
                  class="w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors ${flipped ? 'bg-red-500/20 text-red-400' : 'text-gray-600 hover:text-gray-400 hover:bg-gray-700/50'}">&plusmn;</button>
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
      <div class="text-xs text-gray-500">No markets match filters</div>
      <div class="text-[10px] text-gray-600 mt-1">Try adjusting search or unchecking filters</div>
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
      if (builderState.selectedMarkets[m.mid] == null) builderState.selectedMarkets[m.mid] = { w: 100, flip: false };
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
    builderState.selectedMarkets[mid] = { w: 100, flip: false };
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
  builderState.selectedMarkets[mid] = { w: val, flip: isMarketFlipped(prev) };
  const label = document.getElementById('mw-' + mid);
  if (label) label.textContent = val + '%';
  updateBuilderChart();
}

function toggleMarketFlip(mid, event) {
  if (event) event.stopPropagation();
  const prev = builderState.selectedMarkets[mid];
  if (!prev) return;
  builderState.selectedMarkets[mid] = { w: getMarketWeight(prev), flip: !isMarketFlipped(prev) };
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
    <label class="text-xs text-gray-500">Test Against</label>
    <select onchange="setBuilderReferenceAsset(this.value)" class="px-2 py-1 text-xs bg-gray-800 border border-gray-700/50 rounded text-gray-300 cursor-pointer">
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
  const lastScore = [...ts.scores].reverse().find(s => s != null);

  const corrColor = corr != null ? (Math.abs(corr) > 0.5 ? 'text-green-400' : Math.abs(corr) > 0.3 ? 'text-yellow-400' : 'text-gray-400') : 'text-gray-500';
  const scoreStr = lastScore != null ? lastScore.toFixed(1) : '--';
  const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(3) : '--';
  const dirStr = dirAcc != null ? dirAcc.toFixed(1) + '%' : '--';

  const mktCount = Object.keys(builderState.selectedMarkets).length;
  el.innerHTML = `
    <span class="text-lg font-semibold text-gray-100 tabular-nums">${scoreStr}</span>
    <span class="text-xs text-gray-500">${mktCount} markets</span>
    <span class="text-xs ${corrColor} tabular-nums">r=${corrStr}</span>
    <span class="text-xs text-gray-500 tabular-nums">${dirStr} dir</span>`;
}

// (Market browser removed — replaced by market picker in right panel)

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

  const indicator = {
    id: builderState.editingId || generateId(),
    name,
    markets: { ...builderState.selectedMarkets },
    referenceAsset: builderState.referenceAsset,
    fgEnabled: builderState.fgEnabled,
    fgWeight: builderState.fgWeight,
    isPublic: true,
    pricePer100: null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    _fromServer: !!existing?._fromServer,
  };

  await saveIndicatorToStorage(indicator);
  builderState.editingId = null;
  builderState.selectedMarkets = {};
  builderState.fgEnabled = false;
  builderState.fgWeight = 30;

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

  builderState.editingId = id;
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  builderState.referenceAsset = ind.referenceAsset || null;

  if (ind.markets) {
    builderState.selectedMarkets = normalizeMarketConfig(ind.markets, ind.sector || 'crypto');
  } else if (ind.weights) {
    const sectorData = sectorDataCache[ind.sector || 'crypto'];
    builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset);
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

function computeBacktest(scores, prices, entryThreshold, exitThreshold, strategy) {
  if (!scores || !prices || scores.length < 2) return null;

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

  let position = false;
  let entryPrice = 0;
  let equity = 1;
  let maxEquity = 1;
  let maxDrawdown = 0;
  let trades = 0;
  let wins = 0;
  const equityCurve = [];
  const bhCurve = [];
  const dailyReturns = [];
  let prevEquity = 1;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] == null || prices[i] == null) {
      equityCurve.push(equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : 1);
      bhCurve.push(bhCurve.length > 0 ? bhCurve[bhCurve.length - 1] : 1);
      continue;
    }

    // Update equity if in position (mark-to-market)
    if (position && entryPrice > 0) {
      const prevClose = i > 0 && prices[i - 1] != null ? prices[i - 1] : entryPrice;
      const dayPnl = (prices[i] - prevClose) / prevClose;
      equity *= (1 + dayPnl);
    }

    // Trading logic
    if (!position && shouldEnter(scores[i])) {
      position = true;
      entryPrice = prices[i];
      trades++;
    } else if (position && shouldExit(scores[i])) {
      const pnl = (prices[i] - entryPrice) / entryPrice;
      if (pnl > 0) wins++;
      position = false;
    }

    if (equity > maxEquity) maxEquity = equity;
    const dd = (maxEquity - equity) / maxEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Track daily return for Sharpe
    if (prevEquity > 0) dailyReturns.push(equity / prevEquity - 1);
    prevEquity = equity;

    equityCurve.push(equity);
    bhCurve.push(prices[i] / basePrice);
  }

  const totalReturn = equity - 1;
  const lastBh = bhCurve.length > 0 ? bhCurve[bhCurve.length - 1] - 1 : 0;

  // Annualized Sharpe (sqrt(252) * mean/stdev of daily returns)
  let sharpe = null;
  if (dailyReturns.length > 10) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / dailyReturns.length;
    const stdev = Math.sqrt(variance);
    if (stdev > 0) sharpe = (mean / stdev) * Math.sqrt(252);
  }

  return {
    totalReturn: totalReturn * 100,
    maxDrawdown: maxDrawdown * 100,
    trades,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    buyHold: lastBh * 100,
    alpha: (totalReturn - lastBh) * 100,
    sharpe,
    equityCurve,
    bhCurve,
  };
}

// Backtest slider/input sync helpers
function syncBtInput(which, val) {
  const numEl = document.getElementById(`bt-${which}`);
  if (numEl) numEl.value = val;
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

  const result = computeBacktest(ts.scores, ts.prices, entryThreshold, exitThreshold, btStrategy);
  if (!result) {
    resultsEl.innerHTML = '<span class="text-gray-500 text-xs">Insufficient data — need scores and a reference asset</span>';
    if (equityWrap) equityWrap.classList.add('hidden');
    return;
  }

  const retColor = result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400';
  const alphaColor = result.alpha >= 0 ? 'text-green-400' : 'text-red-400';
  const sharpeStr = result.sharpe != null ? result.sharpe.toFixed(2) : '--';

  resultsEl.innerHTML = `
    <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-x-5 gap-y-2">
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Return</div><div class="${retColor} text-sm font-semibold tabular-nums">${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(1)}%</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Buy & Hold</div><div class="text-gray-300 text-sm font-semibold tabular-nums">${result.buyHold >= 0 ? '+' : ''}${result.buyHold.toFixed(1)}%</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Alpha</div><div class="${alphaColor} text-sm font-semibold tabular-nums">${result.alpha >= 0 ? '+' : ''}${result.alpha.toFixed(1)}%</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Max DD</div><div class="text-red-400 text-sm font-semibold tabular-nums">&minus;${result.maxDrawdown.toFixed(1)}%</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Trades</div><div class="text-gray-200 text-sm font-semibold tabular-nums">${result.trades}</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Win Rate</div><div class="text-gray-200 text-sm font-semibold tabular-nums">${result.winRate.toFixed(0)}%</div></div>
      <div><div class="text-[10px] text-gray-500 uppercase tracking-wide">Sharpe</div><div class="text-gray-200 text-sm font-semibold tabular-nums">${sharpeStr}</div></div>
    </div>`;

  // Equity curve
  if (equityWrap && result.equityCurve && result.equityCurve.length > 1) {
    equityWrap.classList.remove('hidden');
    _renderEquityCurve(result.equityCurve, result.bhCurve, ts.dates);
  } else if (equityWrap) {
    equityWrap.classList.add('hidden');
  }
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
        legend: { position: 'bottom', labels: { color: '#6b7280', usePointStyle: true, pointStyle: 'line', font: { size: 10 } } },
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
