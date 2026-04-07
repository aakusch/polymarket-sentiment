// ── Indicators & Builder — Multi-Sector Polymarket Indicators ────────────────

// ── Builder State ───────────────────────────────────────────────────────────

let builderState = {
  sector: 'crypto',
  asset: 'BTC',
  data: null,      // loaded via loadSectorData
  refMap: null,
  chartInstance: null,
  selectedMarkets: {},  // { marketId: weight } — per-market mode
  fgEnabled: false,
  fgWeight: 30,
  chartPeriod: 'ALL',
  editingId: null,
  initialized: false,
  marketSearch: '',     // search filter text
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

// ── Helper: get default selected markets for a sector/asset ─────────────

function getDefaultSelectedMarkets(sectorData, asset) {
  const assetData = sectorData?.sandbox?.assets?.[asset];
  if (!assetData?.markets) return {};
  const selected = {};
  for (const [mid, m] of Object.entries(assetData.markets)) {
    if (m.cat !== 'other') selected[mid] = 100;
  }
  return selected;
}

// ── Core Computation (sector-aware) ────────────────────────────────────────

function computeIndicatorTimeseries(config, sectorData) {
  const data = sectorData.sandbox;
  const refMap = sectorData.refMap;
  const sector = SECTORS[config.sector || 'crypto'];
  const assetData = data?.assets?.[config.asset];
  if (!assetData || !sector) return { dates: [], scores: [], prices: [], fgValues: [] };

  const dates = assetData.dates;
  const priceKey = sector.referenceData.priceKey;
  const fgSig = sector.referenceData.externalSignals.find(s => s.id === 'fear_greed');
  const fgKey = fgSig?.key;

  const isMarketMode = !!config.markets;

  const scores = [];
  const prices = [];
  const fgValues = [];

  for (let i = 0; i < dates.length; i++) {
    let num = 0, den = 0;

    if (isMarketMode) {
      // Per-market weighting
      const mkts = assetData.markets || {};
      for (const [mid, w] of Object.entries(config.markets)) {
        const m = mkts[mid];
        if (!m || m.ss[i] == null) continue;
        const userW = w / 100;
        num += userW * m.ss[i] * m.wt[i];
        den += userW * m.wt[i];
      }
    } else {
      // Legacy category weighting
      const catKeys = Object.keys(sector.categories).filter(c => c !== 'other');
      if (config.includeOther && sector.categories.other) catKeys.push('other');
      for (const cat of catKeys) {
        const w = (config.weights[cat] || 0) / 100;
        const cd = assetData.cats[cat];
        if (!cd || w === 0) continue;
        num += w * cd.ws[i];
        den += w * cd.wt[i];
      }
    }

    let score = den > 0 ? ((num / den) + 1) * 50 : null;
    const ref = refMap?.[dates[i]];
    const fg = fgKey ? ref?.[fgKey] : null;
    if (score != null && config.fgEnabled && fg != null) {
      const blend = (config.fgWeight || 30) / 100;
      score = score * (1 - blend) + fg * blend;
    }

    scores.push(score);
    prices.push(priceKey ? (ref?.[priceKey] ?? null) : null);
    fgValues.push(fg ?? null);
  }

  return { dates, scores, prices, fgValues };
}

function computeBuilderTimeseries() {
  const sd = builderState;
  const sector = SECTORS[sd.sector];
  if (!sd.data || !sector) return { dates: [], scores: [], prices: [], fgValues: [], catScores: {} };

  const assetData = sd.data.sandbox?.assets?.[sd.asset];
  if (!assetData) return { dates: [], scores: [], prices: [], fgValues: [], catScores: {} };

  const dates = assetData.dates;
  const priceKey = sector.referenceData.priceKey;
  const fgSig = sector.referenceData.externalSignals.find(s => s.id === 'fear_greed');
  const fgKey = fgSig?.key;

  const scores = [];
  const prices = [];
  const fgValues = [];

  // Per-market mode: group selected markets by category for cat breakdown
  const selectedMarkets = sd.selectedMarkets || {};
  const hasMarkets = Object.keys(selectedMarkets).length > 0;
  const mkts = assetData.markets || {};

  // Build category breakdown from selected markets
  const catScores = {};
  const activeCats = new Set();
  if (hasMarkets) {
    for (const mid of Object.keys(selectedMarkets)) {
      const m = mkts[mid];
      if (m) activeCats.add(m.cat);
    }
  }
  for (const c of activeCats) {
    if (c !== 'other') catScores[c] = [];
  }

  for (let i = 0; i < dates.length; i++) {
    let num = 0, den = 0;

    if (hasMarkets) {
      for (const [mid, w] of Object.entries(selectedMarkets)) {
        const m = mkts[mid];
        if (!m || m.ss[i] == null) continue;
        const userW = w / 100;
        num += userW * m.ss[i] * m.wt[i];
        den += userW * m.wt[i];
      }
    }

    let score = den > 0 ? ((num / den) + 1) * 50 : null;
    const ref = sd.refMap?.[dates[i]];
    const fg = fgKey ? ref?.[fgKey] : null;
    if (score != null && sd.fgEnabled && fg != null) {
      const blend = sd.fgWeight / 100;
      score = score * (1 - blend) + fg * blend;
    }

    scores.push(score);
    prices.push(priceKey ? (ref?.[priceKey] ?? null) : null);
    fgValues.push(fg ?? null);

    // Per-category breakdown from selected markets
    for (const cat of Object.keys(catScores)) {
      let cNum = 0, cDen = 0;
      for (const [mid, w] of Object.entries(selectedMarkets)) {
        const m = mkts[mid];
        if (!m || m.cat !== cat || m.ss[i] == null) continue;
        cNum += m.ss[i] * m.wt[i];
        cDen += m.wt[i];
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
// PAGE 1: INDICATORS (Landing — Sector Sections)
// ═════════════════════════════════════════════════════════════════════════════

async function renderIndicatorsPage() {
  const container = document.getElementById('indicators-sectors');
  if (!container) return;

  // Destroy old sparklines
  sparklineCharts.forEach(c => c.destroy());
  sparklineCharts = [];

  const indicators = await getIndicators();

  // Group indicators by sector
  const bySector = {};
  for (const ind of indicators) {
    const s = ind.sector || 'crypto';
    if (!bySector[s]) bySector[s] = [];
    bySector[s].push(ind);
  }

  // Load data for sectors that have indicators
  const sectorsWithData = new Set(Object.keys(bySector).filter(s => SECTORS[s]?.available));
  const loadPromises = [...sectorsWithData].map(s => loadSectorData(s));
  await Promise.all(loadPromises);

  let html = '';

  for (const sectorId of SECTOR_ORDER) {
    const sector = SECTORS[sectorId];
    const sectorIndicators = bySector[sectorId] || [];
    const sectorData = sectorDataCache[sectorId];

    if (sector.available) {
      html += `
        <div class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-medium text-gray-200">${sector.label}</h2>
              <p class="text-sm text-gray-500">${sector.description}</p>
            </div>
            <a href="#builder?sector=${sectorId}" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">+ New</a>
          </div>`;

      if (sectorIndicators.length === 0) {
        html += `
          <div class="bg-gray-900/50 rounded-2xl p-8 border border-gray-800/50 text-center">
            <div class="text-gray-400 mb-2">No indicators yet</div>
            <p class="text-gray-500 text-sm mb-4">Build your first ${sector.label.toLowerCase()} indicator.</p>
            <a href="#builder?sector=${sectorId}" class="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">Build &rarr;</a>
          </div>`;
      } else {
        // Compute and rank — gracefully handle missing sector data
        const ranked = sectorIndicators.map(ind => {
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

        ranked.sort((a, b) => {
          const ca = a.corr != null ? Math.abs(a.corr) : -1;
          const cb = b.corr != null ? Math.abs(b.corr) : -1;
          if (cb !== ca) return cb - ca;
          return (b.dirAcc || 0) - (a.dirAcc || 0);
        });

        html += renderIndicatorTable(ranked, sector);
      }

      html += `</div>`;
    } else {
      // Placeholder sector
      html += `
        <div class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-medium text-gray-200">${sector.label}</h2>
              <p class="text-sm text-gray-500">${sector.description}</p>
            </div>
          </div>
          <div class="bg-gray-900/50 rounded-2xl p-6 border border-gray-800/50 text-center">
            <span class="text-gray-500 text-sm">Coming Soon</span>
          </div>
        </div>`;
    }
  }

  container.innerHTML = html;

  // Render sparklines after DOM update
  requestAnimationFrame(async () => {
    const indicators = await getIndicators();
    for (const sectorId of SECTOR_ORDER) {
      const sectorData = sectorDataCache[sectorId];
      if (!sectorData) continue;
      const sectorInds = indicators.filter(ind => (ind.sector || 'crypto') === sectorId);
      for (const ind of sectorInds) {
        const canvas = document.getElementById('spark-' + ind.id);
        if (canvas) {
          const ts = computeIndicatorTimeseries(ind, sectorData);
          const chart = renderSparkline(canvas, ts.scores, ts.prices);
          sparklineCharts.push(chart);
        }
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

function renderIndicatorTable(ranked, sector) {
  const catMeta = sector.categories;

  let html = `
    <div style="background:rgba(17,24,39,0.5);border-radius:16px;border:1px solid rgba(55,65,81,0.5);overflow:hidden">
      <table class="ind-table" style="font-size:12px">
        <thead>
          <tr style="border-bottom:1px solid rgba(55,65,81,0.5)">
            <th style="padding:10px 4px 10px 16px;width:28px;font-weight:500;color:#6b7280"></th>
            <th style="padding:10px 8px;width:80px;font-weight:500;color:#6b7280">Chart</th>
            <th style="padding:10px 8px;font-weight:500;color:#6b7280">Indicator</th>
            <th style="padding:10px 8px;width:52px;text-align:center;font-weight:500;color:#6b7280">Score</th>
            <th style="padding:10px 8px;font-weight:500;color:#6b7280" class="hidden md:table-cell">Components</th>
            <th style="padding:10px 8px;width:44px;text-align:center;font-weight:500;color:#6b7280" class="hidden sm:table-cell">1W</th>
            <th style="padding:10px 8px;width:44px;text-align:center;font-weight:500;color:#6b7280" class="hidden sm:table-cell">1M</th>
            <th style="padding:10px 8px;width:52px;text-align:center;font-weight:500;color:#6b7280" class="hidden lg:table-cell">Corr</th>
            <th style="padding:10px 16px 10px 8px;width:80px;text-align:right;font-weight:500;color:#6b7280"></th>
          </tr>
        </thead>
        <tbody>`;

  for (let rank = 0; rank < ranked.length; rank++) {
    const { ind, corr, deltas, lastScore } = ranked[rank];

    const scoreStr = lastScore != null ? lastScore.toFixed(1) : '--';
    const sColor = lastScore != null ? scoreColor(lastScore) : '#6b7280';
    const corrStr = corr != null ? (corr > 0 ? '+' : '') + corr.toFixed(2) : '--';
    const corrClr = corr != null ? (Math.abs(corr) > 0.5 ? '#4ade80' : Math.abs(corr) > 0.3 ? '#fbbf24' : '#9ca3af') : '#4b5563';
    const components = getIndicatorComponents(ind, catMeta);
    const escapedName = ind.name.replace(/'/g, "\\'");

    html += `
          <tr>
            <td style="padding:10px 4px 10px 16px;vertical-align:middle">
              <input type="checkbox" data-compare-id="${ind.id}" onchange="toggleCompareIndicator('${ind.id}')"
                style="width:13px;height:13px;cursor:pointer;accent-color:#60a5fa;border-radius:3px">
            </td>
            <td style="padding:10px 8px;vertical-align:middle">
              <div style="height:30px;width:72px"><canvas id="spark-${ind.id}"></canvas></div>
            </td>
            <td style="padding:10px 8px;vertical-align:middle">
              <div style="font-size:13px;color:#e5e7eb;font-weight:500;line-height:1.3">${ind.name}</div>
              <div style="font-size:10px;color:#6b7280;margin-top:1px">${ind.asset}</div>
            </td>
            <td style="padding:10px 8px;text-align:center;vertical-align:middle">
              <span style="font-size:14px;font-weight:600;color:${sColor};font-variant-numeric:tabular-nums">${scoreStr}</span>
            </td>
            <td style="padding:10px 8px;vertical-align:middle;white-space:normal" class="hidden md:table-cell">
              <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">${components}</div>
            </td>
            <td style="padding:10px 8px;text-align:center;vertical-align:middle;font-variant-numeric:tabular-nums" class="hidden sm:table-cell">${fmtDelta(deltas['1W'])}</td>
            <td style="padding:10px 8px;text-align:center;vertical-align:middle;font-variant-numeric:tabular-nums" class="hidden sm:table-cell">${fmtDelta(deltas['1M'])}</td>
            <td style="padding:10px 8px;text-align:center;vertical-align:middle;font-variant-numeric:tabular-nums" class="hidden lg:table-cell"><span style="color:${corrClr}">${corrStr}</span></td>
            <td style="padding:10px 16px 10px 8px;text-align:right;vertical-align:middle">
              <span style="display:inline-flex;gap:2px">
                <button onclick="openAlertModal('${ind.id}','${escapedName}')" style="padding:2px 4px;color:#6b7280;background:none;border:none;cursor:pointer;font-size:13px" title="Alert">&#128276;</button>
                <button onclick="editIndicator('${ind.id}')" style="padding:2px 4px;color:#6b7280;background:none;border:none;cursor:pointer;font-size:13px" title="Edit">&#9998;</button>
                <button onclick="confirmDeleteIndicator('${ind.id}')" style="padding:2px 4px;color:#6b7280;background:none;border:none;cursor:pointer;font-size:14px" title="Delete">&times;</button>
              </span>
            </td>
          </tr>`;
  }

  html += `
        </tbody>
      </table>
    </div>`;

  return html;
}

async function editIndicator(id) {
  const ind = (await getIndicators()).find(i => i.id === id);
  if (!ind) return;
  builderState.editingId = id;
  builderState.sector = ind.sector || 'crypto';
  builderState.asset = ind.asset;
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;
  // selectedMarkets loaded in renderBuilderPage after data is available
  location.hash = '#builder?sector=' + builderState.sector;
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
  // Parse sector from URL
  const hash = location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  const urlSector = params.get('sector');
  const editId = params.get('id');

  // If editing, load from indicator
  if (editId && editId !== builderState.editingId) {
    builderState.editingId = editId;
    const ind = (await getIndicators()).find(i => i.id === editId);
    if (ind) {
      builderState.sector = ind.sector || 'crypto';
      builderState.asset = ind.asset;
      builderState.fgEnabled = ind.fgEnabled || false;
      builderState.fgWeight = ind.fgWeight || 30;
      // Defer selectedMarkets loading until after data is loaded (need market data for migration)
    }
  } else if (urlSector && urlSector !== builderState.sector && SECTORS[urlSector]?.available) {
    // Switching sector from URL
    builderState.sector = urlSector;
    builderState.selectedMarkets = {};
    builderState.fgEnabled = false;
    builderState.fgWeight = 30;
    builderState.editingId = null;
    builderState.initialized = false;
  }

  // Load sector data
  const sectorData = await loadSectorData(builderState.sector);
  if (!sectorData) return;
  builderState.data = sectorData;
  builderState.refMap = sectorData.refMap;

  // Default asset if current isn't in this sector's data
  const assets = Object.keys(sectorData.sandbox.assets || {});
  if (!assets.includes(builderState.asset) && assets.length > 0) {
    builderState.asset = assets[0];
  }

  // Load indicator markets after data is available (handles migration)
  if (editId && editId === builderState.editingId) {
    const ind = (await getIndicators()).find(i => i.id === editId);
    if (ind) {
      if (ind.markets) {
        builderState.selectedMarkets = { ...ind.markets };
      } else if (ind.weights) {
        // Legacy migration: select all markets in enabled categories
        builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, sectorData, ind.asset);
      }
    }
  }

  // Default: select all non-other markets if empty and not editing
  if (!builderState.editingId && Object.keys(builderState.selectedMarkets).length === 0) {
    builderState.selectedMarkets = getDefaultSelectedMarkets(sectorData, builderState.asset);
  }

  renderBuilderSectorPills();
  renderBuilderAssetPills();
  renderBuilderMarketPicker();
  renderBuilderSignalSources();
  syncBuilderControls();

  if (!builderState.initialized) {
    initBuilderChart();
    builderState.initialized = true;
  }

  updateBuilderChart();
}

// Migrate legacy category weights to per-market selection
function migrateWeightsToMarkets(weights, includeOther, sectorData, asset) {
  const assetData = sectorData?.sandbox?.assets?.[asset];
  if (!assetData?.markets) return {};
  const selected = {};
  for (const [mid, m] of Object.entries(assetData.markets)) {
    const catWeight = weights[m.cat];
    if (catWeight != null && catWeight > 0) {
      selected[mid] = catWeight;
    } else if (m.cat === 'other' && includeOther && (weights.other || 0) > 0) {
      selected[mid] = weights.other;
    }
  }
  return selected;
}

// ── Builder Sector Pills ──────────────────────────────────────────────────

function renderBuilderSectorPills() {
  const el = document.getElementById('builder-sector-pills');
  if (!el) return;
  el.innerHTML = SECTOR_ORDER.map(sId => {
    const s = SECTORS[sId];
    if (!s.available) {
      return `<span class="px-2.5 py-1 text-xs text-gray-600 cursor-not-allowed">${s.label}</span>`;
    }
    const active = sId === builderState.sector;
    return `<button onclick="selectBuilderSector('${sId}')"
      class="px-2.5 py-1 text-xs transition-colors rounded
        ${active ? 'text-gray-200 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}">${s.label}</button>`;
  }).join('');
}

function selectBuilderSector(sectorId) {
  if (sectorId === builderState.sector) return;
  builderState.sector = sectorId;
  builderState.selectedMarkets = {};
  builderState.fgEnabled = false;
  builderState.fgWeight = 30;
  builderState.editingId = null;
  builderState.initialized = false;
  builderState.marketSearch = '';
  // Update URL without re-triggering full render
  history.replaceState(null, '', '#builder?sector=' + sectorId);
  renderBuilderPage();
}

// ── Builder Asset Pills ─────────────────────────────────────────────────────

function renderBuilderAssetPills() {
  const el = document.getElementById('builder-assets');
  if (!el || !builderState.data) return;
  const assets = Object.keys(builderState.data.sandbox.assets || {});

  el.innerHTML = assets.map(a => {
    const active = a === builderState.asset;
    return `<button onclick="selectBuilderAsset('${a}')"
      class="px-2.5 py-1 text-xs transition-colors rounded
        ${active ? 'text-gray-200 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}">${a}</button>`;
  }).join('');
}

async function selectBuilderAsset(asset) {
  // Lazy-load asset data if using split files
  if (typeof loadAssetData === 'function') {
    await loadAssetData(builderState.sector, asset);
  }
  builderState.asset = asset;
  builderState.selectedMarkets = getDefaultSelectedMarkets(builderState.data, asset);
  builderState.marketSearch = '';
  const searchEl = document.getElementById('builder-market-search');
  if (searchEl) searchEl.value = '';
  renderBuilderAssetPills();
  updateBuilderChartRefLabel();
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function updateBuilderChartRefLabel() {
  const sector = SECTORS[builderState.sector];
  const label = sector?.referenceData?.priceLabel || '';
  const el = document.getElementById('builder-chart-ref-label');
  if (el) el.textContent = label || (builderState.asset + ' Price');
}

// ── Builder Market Picker ──────────────────────────────────────────────────

function renderBuilderMarketPicker() {
  const el = document.getElementById('builder-market-picker');
  if (!el) return;

  const sector = SECTORS[builderState.sector];
  const assetData = builderState.data?.sandbox?.assets?.[builderState.asset];
  if (!assetData?.markets) { el.innerHTML = '<div class="text-xs text-gray-500">No market data</div>'; return; }

  const search = builderState.marketSearch.toLowerCase();
  const catOrder = Object.keys(sector.categories);

  // Group markets by category
  const grouped = {};
  for (const cat of catOrder) grouped[cat] = [];
  for (const [mid, m] of Object.entries(assetData.markets)) {
    const cat = catOrder.includes(m.cat) ? m.cat : 'other';
    if (search && !m.q.toLowerCase().includes(search)) continue;
    // Latest weight for sorting (proxy for volume/importance)
    const latestWt = m.wt ? m.wt[m.wt.length - 1] || 0 : 0;
    grouped[cat].push({ mid, latestWt, ...m });
  }
  // Sort each category by latest weight descending
  for (const cat of catOrder) {
    if (grouped[cat]) grouped[cat].sort((a, b) => b.latestWt - a.latestWt);
  }

  let html = '';
  for (const cat of catOrder) {
    const list = grouped[cat];
    if (!list || list.length === 0) continue;

    const meta = sector.categories[cat];
    const selectedInCat = list.filter(m => builderState.selectedMarkets[m.mid] != null);

    html += `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium" style="color:${meta.accent}">${meta.label}
            <span class="text-gray-500 font-normal">${selectedInCat.length}/${list.length}</span>
          </span>
          <div class="flex gap-2">
            <button onclick="selectAllMarketsInCat('${cat}', true)" class="text-[10px] text-gray-500 hover:text-gray-300">All</button>
            <button onclick="selectAllMarketsInCat('${cat}', false)" class="text-[10px] text-gray-500 hover:text-gray-300">None</button>
          </div>
        </div>
        <div class="space-y-1">`;

    for (const m of list) {
      const isSelected = builderState.selectedMarkets[m.mid] != null;
      const weight = builderState.selectedMarkets[m.mid] ?? 100;
      const truncQ = m.q.length > 50 ? m.q.slice(0, 50) + '...' : m.q;

      html += `
        <div class="flex items-center gap-2 py-0.5 group">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleMarket('${m.mid}', this.checked)"
            class="rounded bg-gray-700 border-gray-600 w-3 h-3 shrink-0 cursor-pointer" style="accent-color:${meta.accent}">
          <span class="text-[11px] text-gray-400 truncate flex-1 cursor-default" title="${m.q}">${truncQ}</span>
          ${isSelected ? `
            <input type="range" min="0" max="200" value="${weight}" step="5"
              data-mid="${m.mid}" oninput="onMarketWeightSlider(this)"
              class="w-16 h-1 rounded-full appearance-none cursor-pointer bg-gray-800 shrink-0"
              style="accent-color:${meta.accent}">
            <span class="text-[10px] text-gray-500 tabular-nums w-8 text-right" id="mw-${m.mid}">${weight}%</span>
          ` : ''}
        </div>`;
    }

    html += `</div></div>`;
  }

  if (!html) html = '<div class="text-xs text-gray-500">No markets match search</div>';
  el.innerHTML = html;
}

function onBuilderMarketSearch(val) {
  builderState.marketSearch = val;
  renderBuilderMarketPicker();
}

function toggleMarket(mid, checked) {
  if (checked) {
    builderState.selectedMarkets[mid] = 100;
  } else {
    delete builderState.selectedMarkets[mid];
  }
  renderBuilderMarketPicker();
  updateBuilderChart();
}

function onMarketWeightSlider(input) {
  const mid = input.dataset.mid;
  const val = parseInt(input.value);
  builderState.selectedMarkets[mid] = val;
  const label = document.getElementById('mw-' + mid);
  if (label) label.textContent = val + '%';
  updateBuilderChart();
}

function selectAllMarketsInCat(cat, select) {
  const assetData = builderState.data?.sandbox?.assets?.[builderState.asset];
  if (!assetData?.markets) return;
  const search = builderState.marketSearch.toLowerCase();
  for (const [mid, m] of Object.entries(assetData.markets)) {
    if (m.cat !== cat) continue;
    if (search && !m.q.toLowerCase().includes(search)) continue;
    if (select) {
      if (builderState.selectedMarkets[mid] == null) builderState.selectedMarkets[mid] = 100;
    } else {
      delete builderState.selectedMarkets[mid];
    }
  }
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

// ── Builder Signal Sources (dynamic from sector registry) ─────────────────

function renderBuilderSignalSources() {
  const el = document.getElementById('builder-signal-sources');
  if (!el) return;

  const sector = SECTORS[builderState.sector];
  const signals = sector.referenceData.externalSignals || [];
  if (signals.length === 0) { el.innerHTML = ''; return; }

  let html = `<div class="border-t border-gray-800/50 pt-4 space-y-3">`;
  for (const sig of signals) {
    html += `
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" id="builder-fg-enabled" onchange="onBuilderControlChange()" class="rounded bg-gray-700 border-gray-600 text-blue-500 w-3.5 h-3.5">
        <span class="text-xs text-gray-400">${sig.label}</span>
      </label>
      <div id="builder-fg-blend-wrap" class="hidden">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-gray-500">Blend</span>
          <span id="builder-fg-blend-val" class="text-xs text-gray-500 tabular-nums">30%</span>
        </div>
        <input type="range" id="builder-fg-blend" min="5" max="95" value="30" step="5" oninput="onBuilderFgSliderChange()"
          class="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-gray-800 accent-green-500">
      </div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
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

  const sector = SECTORS[builderState.sector];
  const priceLabel = sector?.referenceData?.priceLabel || 'Price (USD)';

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
              if (ds.yAxisID === 'y2') return `${ds.label}: $${val.toLocaleString()}`;
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
  const sector = SECTORS[builderState.sector];

  // Apply period filter
  const periodDays = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, 'ALL': Infinity };
  const days = periodDays[builderState.chartPeriod] || Infinity;
  let startIdx = 0;
  if (days < Infinity && ts.dates.length > days) {
    startIdx = ts.dates.length - days;
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

  const hasPrices = sector.referenceData.priceKey && slicedPrices.some(p => p != null);
  if (hasPrices) {
    datasets.push({
      label: sector.referenceData.priceLabel || (builderState.asset + ' Price'),
      data: slicedPrices,
      borderColor: LINE_COLORS.btc_price.border,
      backgroundColor: LINE_COLORS.btc_price.bg,
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
    const fgSig = sector.referenceData.externalSignals.find(s => s.id === 'fear_greed');
    datasets.push({
      label: fgSig?.label || 'External Signal',
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
  for (const cat of Object.keys(ts.catScores)) {
    if (ts.catScores[cat] && sector.categories[cat]) {
      datasets.push({
        label: sector.categories[cat].label,
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
    const btcMin = Math.min(...prices);
    const btcMax = Math.max(...prices);
    const pad = (btcMax - btcMin) * 0.1 || 5000;
    chart.options.scales.y2.min = Math.floor((btcMin - pad) / 1000) * 1000;
    chart.options.scales.y2.max = Math.ceil((btcMax + pad) / 1000) * 1000;
    chart.options.scales.y2.display = true;
    chart.options.scales.y2.title.text = sector.referenceData.priceLabel || 'Price (USD)';
  } else {
    chart.options.scales.y2.display = false;
  }

  chart.update('none');
  renderBuilderMetrics(ts);
}

function setBuilderChartPeriod(period) {
  builderState.chartPeriod = period;
  document.querySelectorAll('[data-period]').forEach(btn => {
    const isActive = btn.dataset.period === period;
    btn.classList.toggle('text-blue-400', isActive);
    btn.classList.toggle('text-gray-500', !isActive);
  });
  updateBuilderChart();
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

  el.innerHTML = `
    <span class="text-lg font-semibold text-gray-100 tabular-nums">${scoreStr}</span>
    <span class="text-xs text-gray-500">${builderState.asset}</span>
    <span class="text-xs ${corrColor} tabular-nums">r=${corrStr}</span>
    <span class="text-xs text-gray-500 tabular-nums">${dirStr} dir</span>`;
}

// (Market browser removed — replaced by market picker in right panel)

// ── Save / Load ─────────────────────────────────────────────────────────────

async function saveBuilderIndicator() {
  const existing = builderState.editingId
    ? getIndicatorsSync().find(i => i.id === builderState.editingId)
    : null;
  const name = prompt('Indicator name:', existing?.name || '');
  if (!name) return;

  const indicator = {
    id: builderState.editingId || generateId(),
    name,
    sector: builderState.sector,
    asset: builderState.asset,
    markets: { ...builderState.selectedMarkets },
    fgEnabled: builderState.fgEnabled,
    fgWeight: builderState.fgWeight,
    isPublic: true,
    pricePer100: null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    _fromServer: !!existing?._fromServer,
  };

  await saveIndicatorToStorage(indicator);
  builderState.editingId = null;

  // Reset to defaults
  builderState.selectedMarkets = getDefaultSelectedMarkets(builderState.data, builderState.asset);
  builderState.fgEnabled = false;
  builderState.fgWeight = 30;

  location.hash = '#indicators';
}

function toggleBuilderLoadMenu() {
  const menu = document.getElementById('builder-load-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');

  if (isHidden) {
    const sector = SECTORS[builderState.sector];
    const presets = sector.presets || {};
    const indicators = getIndicatorsSync().filter(ind => (ind.sector || 'crypto') === builderState.sector);
    let html = '';

    if (Object.keys(presets).length > 0) {
      html += '<div class="text-xs text-gray-500 px-3 py-1.5 uppercase tracking-wide">Presets</div>';
      for (const name of Object.keys(presets)) {
        html += `<button onclick="loadBuilderPreset('${name}')" class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors">${name}</button>`;
      }
    }

    if (indicators.length > 0) {
      html += '<div class="border-t border-gray-700 my-1"></div>';
      html += '<div class="text-xs text-gray-500 px-3 py-1.5 uppercase tracking-wide">Saved</div>';
      for (const ind of indicators) {
        html += `<button onclick="loadBuilderIndicator('${ind.id}')" class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors">${ind.name} <span class="text-gray-500">(${ind.asset})</span></button>`;
      }
    }

    if (!html) html = '<div class="px-3 py-2 text-sm text-gray-500">No presets or saved indicators</div>';

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

function loadBuilderPreset(name) {
  const sector = SECTORS[builderState.sector];
  const preset = sector.presets?.[name];
  if (!preset) return;

  // Presets use selectCategories: select all markets in those categories
  const assetData = builderState.data?.sandbox?.assets?.[builderState.asset];
  if (assetData?.markets && preset.selectCategories) {
    const cats = new Set(preset.selectCategories);
    const catWeights = preset.categoryWeights || {};
    const selected = {};
    for (const [mid, m] of Object.entries(assetData.markets)) {
      if (cats.has(m.cat)) selected[mid] = catWeights[m.cat] || preset.defaultWeight || 100;
    }
    builderState.selectedMarkets = selected;
  }

  builderState.fgEnabled = preset.fgEnabled || false;
  builderState.fgWeight = preset.fgWeight || 30;
  builderState.editingId = null;

  syncBuilderControls();
  renderBuilderMarketPicker();
  updateBuilderChart();

  document.getElementById('builder-load-menu')?.classList.add('hidden');
}

function loadBuilderIndicator(id) {
  const ind = getIndicatorsSync().find(i => i.id === id);
  if (!ind) return;

  builderState.editingId = id;
  builderState.asset = ind.asset;
  builderState.fgEnabled = ind.fgEnabled || false;
  builderState.fgWeight = ind.fgWeight || 30;

  if (ind.markets) {
    builderState.selectedMarkets = { ...ind.markets };
  } else if (ind.weights) {
    builderState.selectedMarkets = migrateWeightsToMarkets(ind.weights, ind.includeOther, builderState.data, ind.asset);
  }

  renderBuilderAssetPills();
  syncBuilderControls();
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

function computeBacktest(scores, prices, buyThreshold, sellThreshold) {
  if (!scores || !prices || scores.length < 2) return null;

  let position = false;
  let entryPrice = 0;
  let equity = 1;
  let maxEquity = 1;
  let maxDrawdown = 0;
  let trades = 0;
  let wins = 0;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] == null || prices[i] == null) continue;

    if (!position && scores[i] >= buyThreshold) {
      position = true;
      entryPrice = prices[i];
      trades++;
    } else if (position && scores[i] <= sellThreshold) {
      const pnl = (prices[i] - entryPrice) / entryPrice;
      equity *= (1 + pnl);
      if (equity > maxEquity) maxEquity = equity;
      const dd = (maxEquity - equity) / maxEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (pnl > 0) wins++;
      position = false;
    }
  }

  // Close open position at last price
  if (position) {
    const lastPrice = [...prices].reverse().find(p => p != null);
    if (lastPrice && entryPrice > 0) {
      const pnl = (lastPrice - entryPrice) / entryPrice;
      equity *= (1 + pnl);
      if (pnl > 0) wins++;
    }
  }

  const totalReturn = equity - 1;
  const firstPrice = prices.find(p => p != null);
  const lastPrice = [...prices].reverse().find(p => p != null);
  const buyHold = firstPrice && lastPrice ? (lastPrice - firstPrice) / firstPrice : 0;

  return {
    totalReturn: totalReturn * 100,
    maxDrawdown: maxDrawdown * 100,
    trades,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    buyHold: buyHold * 100,
    alpha: (totalReturn - buyHold) * 100,
  };
}

function renderBacktestPanel() {
  const container = document.getElementById('backtest-panel');
  if (!container) return;

  const ts = computeBuilderTimeseries();
  const buyThreshold = parseInt(document.getElementById('bt-buy')?.value || '60');
  const sellThreshold = parseInt(document.getElementById('bt-sell')?.value || '40');

  const result = computeBacktest(ts.scores, ts.prices, buyThreshold, sellThreshold);
  if (!result) {
    container.querySelector('#bt-results').innerHTML = '<span class="text-gray-500 text-xs">Insufficient data</span>';
    return;
  }

  const retColor = result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400';
  const alphaColor = result.alpha >= 0 ? 'text-green-400' : 'text-red-400';

  container.querySelector('#bt-results').innerHTML = `
    <div class="grid grid-cols-3 gap-3 text-xs">
      <div><div class="text-gray-500">Return</div><div class="${retColor} font-medium tabular-nums">${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(1)}%</div></div>
      <div><div class="text-gray-500">Max DD</div><div class="text-red-400 font-medium tabular-nums">-${result.maxDrawdown.toFixed(1)}%</div></div>
      <div><div class="text-gray-500">Trades</div><div class="text-gray-200 font-medium tabular-nums">${result.trades}</div></div>
      <div><div class="text-gray-500">Win Rate</div><div class="text-gray-200 font-medium tabular-nums">${result.winRate.toFixed(0)}%</div></div>
      <div><div class="text-gray-500">Buy & Hold</div><div class="text-gray-300 font-medium tabular-nums">${result.buyHold >= 0 ? '+' : ''}${result.buyHold.toFixed(1)}%</div></div>
      <div><div class="text-gray-500">Alpha</div><div class="${alphaColor} font-medium tabular-nums">${result.alpha >= 0 ? '+' : ''}${result.alpha.toFixed(1)}%</div></div>
    </div>`;
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
