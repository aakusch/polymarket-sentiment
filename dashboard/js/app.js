// ── Data Loading & Global State ───────────────────────────────────────────

let DATA = { timeseries: null, latest: null, meta: null };
let chartInitialized = false;

async function init() {
  const [ts, latest, meta] = await Promise.all([
    fetch('data/timeseries.json').then(r => r.json()),
    fetch('data/latest.json').then(r => r.json()),
    fetch('data/meta.json').then(r => r.json()),
  ]);
  DATA.timeseries = ts;
  DATA.latest = latest;
  DATA.meta = meta;

  // Set nav score indicator
  const navScore = document.getElementById('nav-score');
  const n = latest.normalized || 50;
  navScore.innerHTML = `<span style="color:${scoreColor(n)}">${n.toFixed(1)}</span><span class="text-gray-600">/100</span>`;

  // Route to current hash
  handleRoute();
}

// ── Hash Router ──────────────────────────────────────────────────────────

function handleRoute() {
  const hash = location.hash || '#overview';
  const page = hash.split('?')[0].replace('#', '') || 'overview';
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');

  // Show/hide pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Update nav
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === page);
  });

  // Render page content
  if (!DATA.latest) return;

  switch (page) {
    case 'overview':
      renderOverview();
      break;
    case 'categories':
      renderCategoriesPage();
      break;
    case 'markets':
      renderMarketsPage(params);
      break;
    case 'methodology':
      renderMethodologyPage();
      break;
    case 'builder':
      renderBuilderPage(params);
      break;
  }
}

window.addEventListener('hashchange', handleRoute);

// ── Score Utilities ──────────────────────────────────────────────────────

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

// ── Overview Page ────────────────────────────────────────────────────────

function renderOverview() {
  renderHero(DATA.latest);
  renderMetrics(DATA.latest);
  renderAssetCards(DATA.latest.by_asset || {});
  renderForwardCurve(DATA.latest.by_horizon || {});
  if (!chartInitialized) {
    initChart(DATA.timeseries.data);
    chartInitialized = true;
  }
}

// ── Hero Section ─────────────────────────────────────────────────────────

function renderHero(latest) {
  const el = document.getElementById('hero');
  const n = latest.normalized;
  const color = scoreColor(n);
  const label = scoreLabel(n);
  const delta = latest.delta || {};
  const deltaVal = delta.composite || 0;
  const arrow = deltaVal > 0 ? '+' : '';

  const btcStr = latest.btc_price ? ` &middot; BTC ${fmtBTC(latest.btc_price)}` : '';
  const fngStr = latest.fear_greed != null ? ` &middot; F&amp;G: ${latest.fear_greed}` : '';

  el.innerHTML = `
    <div class="text-center">
      <h1 class="text-2xl font-light text-gray-400 mb-2 tracking-wide">POLYMARKET CRYPTO SENTIMENT</h1>
      <div class="text-8xl font-bold mb-2" style="color:${color}">${n.toFixed(1)}</div>
      <div class="text-lg font-medium mb-1" style="color:${color}">${label}</div>
      <div class="text-sm text-gray-400">
        ${deltaVal !== 0 ? `<span class="${deltaVal > 0 ? 'text-green-400' : 'text-red-400'}">${arrow}${deltaVal.toFixed(1)} pts</span> from yesterday &middot; ` : ''}
        ${latest.market_count} markets &middot; ${fmt$(latest.volume_24h)} 24h volume${btcStr}${fngStr} &middot; Updated ${fmtDate(latest.date)}
      </div>
    </div>
  `;
}

// ── Metrics Row ──────────────────────────────────────────────────────────

function renderMetrics(latest) {
  const el = document.getElementById('metrics');
  const items = [
    ['Volume 24h', fmt$(latest.volume_24h)],
    ['Open Interest', fmt$(latest.open_interest)],
    ['Avg Liquidity', fmt$(latest.avg_liquidity)],
    ['Bullish %', (latest.bullish_pct || 0).toFixed(1) + '%'],
    ['Markets', latest.market_count],
  ];
  el.innerHTML = items.map(([label, val]) => `
    <div class="bg-gray-800/50 rounded-lg px-4 py-3 text-center">
      <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
      <div class="text-lg font-semibold text-gray-200 mt-1">${val}</div>
    </div>
  `).join('');
}

// ── Asset Sentiment Cards ────────────────────────────────────────────────

function renderAssetCards(byAsset) {
  const el = document.getElementById('asset-cards');
  const entries = Object.entries(byAsset);
  if (!entries.length) {
    el.innerHTML = '<div class="text-sm text-gray-500">No asset data available</div>';
    return;
  }

  // Build sparkline data per asset from timeseries (last 7 days)
  const tsData = (DATA.timeseries?.data || []).slice(-7);

  el.innerHTML = entries.map(([asset, data]) => {
    const score = data.score || 50;
    const color = scoreColor(score);
    return `
      <a href="#markets?asset=${asset}" class="asset-card flex-shrink-0 w-40 bg-gray-800/50 rounded-xl p-4 border border-gray-700/30 cursor-pointer">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-gray-300">${asset}</span>
          <span class="text-xs text-gray-500">${data.market_count}</span>
        </div>
        <div class="text-2xl font-bold mb-1" style="color:${color}">${score.toFixed(1)}</div>
        <div class="text-xs text-gray-500">${fmt$(data.volume_24h)} vol</div>
      </a>
    `;
  }).join('');
}

// ── Forward Curve ────────────────────────────────────────────────────────

function renderForwardCurve(byHorizon) {
  const el = document.getElementById('forward-curve');
  const labels = { '1w': '< 1 Week', '1m': '1 Week - 1 Month', '3m': '1 - 3 Months', '6m+': '3+ Months' };
  const order = ['1w', '1m', '3m', '6m+'];

  el.innerHTML = order.map(key => {
    const data = byHorizon[key] || { score: 50, market_count: 0 };
    const score = data.score || 50;
    const color = scoreColor(score);
    const pct = score;
    return `
      <div class="flex items-center gap-4">
        <div class="w-36 text-sm text-gray-400 shrink-0">${labels[key]}</div>
        <div class="flex-1 bg-gray-800 rounded-full h-6 relative overflow-hidden">
          <div class="absolute inset-y-0 left-0 rounded-full transition-all" style="width:${pct}%;background:${color}"></div>
          <div class="absolute inset-y-0 left-1/2 w-px bg-gray-600"></div>
        </div>
        <div class="w-16 text-right">
          <span class="text-sm font-semibold tabular-nums" style="color:${color}">${score.toFixed(1)}</span>
        </div>
        <div class="w-20 text-right text-xs text-gray-500">${data.market_count} mkts</div>
      </div>
    `;
  }).join('');
}

// ── Categories Page ──────────────────────────────────────────────────────

const CAT_META = {
  price_targets: { label: 'Price Targets', icon: '\u{1F3AF}', desc: 'Markets asking whether crypto prices will reach specific levels. Includes "above", "below", and range targets.' },
  regulatory: { label: 'Regulatory', icon: '\u{2696}\u{FE0F}', desc: 'Markets about government regulation, legislation, enforcement, and legal developments.' },
  adoption: { label: 'Adoption', icon: '\u{1F680}', desc: 'Markets about user growth, partnerships, institutional adoption, and ecosystem milestones.' },
  events: { label: 'Events', icon: '\u{26A1}', desc: 'Markets about specific events like ETF approvals, hacks, protocol upgrades, or market crashes.' },
};

function renderCategoriesPage() {
  const el = document.getElementById('category-sections');
  const subs = DATA.latest.sub_scores || {};
  const markets = DATA.latest.markets || [];

  el.innerHTML = Object.entries(CAT_META).map(([key, meta]) => {
    const s = subs[key] || { normalized: 50, market_count: 0 };
    const color = scoreColor(s.normalized);
    const catMarkets = markets
      .filter(m => m.category === key)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    const marketRows = catMarkets.map(m => `
      <tr class="border-b border-gray-800/30">
        <td class="py-2 pr-3 text-sm text-gray-300 max-w-sm"><div class="truncate" title="${m.question}">${m.question}</div></td>
        <td class="py-2 px-3 text-sm tabular-nums text-gray-300">${(m.probability * 100).toFixed(1)}%</td>
        <td class="py-2 px-3 text-sm tabular-nums ${m.signal > 0 ? 'text-green-400' : m.signal < 0 ? 'text-red-400' : 'text-gray-400'}">${m.signal > 0 ? '+' : ''}${m.signal.toFixed(3)}</td>
        <td class="py-2 pl-3 text-sm tabular-nums text-gray-400 text-right">${fmt$(m.volume_24h)}</td>
      </tr>
    `).join('');

    return `
      <div class="bg-gray-900/50 rounded-2xl p-6 border border-gray-800/50 mb-6">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h3 class="text-lg font-medium text-gray-200">${meta.icon} ${meta.label}</h3>
            <p class="text-sm text-gray-500 mt-1">${meta.desc}</p>
          </div>
          <div class="text-right">
            <div class="text-3xl font-bold" style="color:${color}">${s.normalized.toFixed(1)}</div>
            <div class="text-xs text-gray-500">${s.market_count} markets</div>
          </div>
        </div>
        ${catMarkets.length > 0 ? `
        <table class="w-full text-left mt-4">
          <thead><tr class="border-b border-gray-800"><th class="py-1 pr-3 text-xs text-gray-500">Market</th><th class="py-1 px-3 text-xs text-gray-500">Prob</th><th class="py-1 px-3 text-xs text-gray-500">Signal</th><th class="py-1 pl-3 text-xs text-gray-500 text-right">Volume 24h</th></tr></thead>
          <tbody>${marketRows}</tbody>
        </table>
        <div class="mt-3"><a href="#markets?category=${key}" class="text-xs text-blue-400 hover:text-blue-300">View all ${key.replace('_', ' ')} markets &rarr;</a></div>
        ` : '<div class="text-sm text-gray-500 mt-4">No classified markets in this category</div>'}
      </div>
    `;
  }).join('');
}

// ── Markets Page ─────────────────────────────────────────────────────────

function renderMarketsPage(params) {
  // Init table with optional pre-populated filters from URL params
  const markets = DATA.latest.markets || [];
  const preFilters = {};
  if (params && params.get('category')) preFilters.category = params.get('category');
  if (params && params.get('asset')) preFilters.asset = params.get('asset');
  initTable(markets, preFilters);
}

// ── Methodology Page ─────────────────────────────────────────────────────

function renderMethodologyPage() {
  const el = document.getElementById('methodology-content');
  const meth = DATA.meta.methodology;
  const cats = meth.categories;

  const catRows = Object.entries(cats).map(([k, v]) =>
    `<tr><td class="py-1.5 pr-4 text-gray-300 font-medium">${k}</td><td class="py-1.5 pr-4 text-gray-400">${v.types.join(', ')}</td><td class="py-1.5 text-gray-500">${v.description}</td></tr>`
  ).join('');

  // Classification stats from actual data
  const markets = DATA.latest.markets || [];
  const total = markets.length;
  const classified = markets.filter(m => m.category !== 'unclassified').length;
  const pctClassified = total > 0 ? ((classified / total) * 100).toFixed(0) : 0;

  el.innerHTML = `
    <div class="space-y-8">
      <!-- Scoring Formulas -->
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
          <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Market Signal</h4>
          <div class="bg-gray-800 rounded-lg p-4 font-mono text-sm text-blue-300 mb-2">${meth.signal.formula}</div>
          <p class="text-sm text-gray-500">${meth.signal.description}</p>
        </div>
        <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
          <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Market Weight</h4>
          <div class="bg-gray-800 rounded-lg p-4 font-mono text-sm text-blue-300 mb-2">${meth.weight.formula}</div>
          <p class="text-sm text-gray-500">${meth.weight.description}</p>
        </div>
        <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
          <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Composite Score</h4>
          <div class="bg-gray-800 rounded-lg p-4 font-mono text-sm text-blue-300 mb-2">${meth.composite.formula}</div>
          <p class="text-sm text-gray-500">${meth.composite.description}</p>
        </div>
        <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
          <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Weight Parameters</h4>
          <div class="bg-gray-800 rounded-lg p-4 text-sm text-gray-400 space-y-1">
            <div>Volume ceiling: <span class="text-gray-200">${meth.weight.params.volume_ceiling}</span></div>
            <div>Liquidity ceiling: <span class="text-gray-200">${meth.weight.params.liquidity_ceiling}</span></div>
            <div>OI ceiling: <span class="text-gray-200">${meth.weight.params.oi_ceiling}</span></div>
            <div>Time decay horizon: <span class="text-gray-200">${meth.weight.params.time_decay_horizon}</span></div>
          </div>
        </div>
      </div>

      <!-- Data Pipeline Diagram -->
      <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
        <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Data Pipeline</h4>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="bg-blue-900/40 text-blue-300 px-3 py-1.5 rounded-lg">Polymarket API</span>
          <span class="text-gray-600">&rarr;</span>
          <span class="bg-purple-900/40 text-purple-300 px-3 py-1.5 rounded-lg">Discovery + Noise Filter</span>
          <span class="text-gray-600">&rarr;</span>
          <span class="bg-orange-900/40 text-orange-300 px-3 py-1.5 rounded-lg">Keyword Classifier + Asset Tagger</span>
          <span class="text-gray-600">&rarr;</span>
          <span class="bg-teal-900/40 text-teal-300 px-3 py-1.5 rounded-lg">Order Book Collection</span>
          <span class="text-gray-600">&rarr;</span>
          <span class="bg-pink-900/40 text-pink-300 px-3 py-1.5 rounded-lg">Weighted Scoring</span>
          <span class="text-gray-600">&rarr;</span>
          <span class="bg-green-900/40 text-green-300 px-3 py-1.5 rounded-lg">Composite Index</span>
        </div>
      </div>

      <!-- Noise Filtering -->
      ${meth.noise_filtering ? `
      <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
        <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Noise Filtering</h4>
        <p class="text-sm text-gray-400">${meth.noise_filtering.description}</p>
        <p class="text-xs text-gray-500 mt-2">Criteria: ${meth.noise_filtering.criteria}</p>
      </div>` : ''}

      <!-- Signal Categories -->
      <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
        <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Signal Categories</h4>
        <div class="overflow-x-auto">
          <table class="text-sm w-full">
            <thead><tr class="text-left text-gray-500 border-b border-gray-800"><th class="py-1.5 pr-4">Category</th><th class="py-1.5 pr-4">Signal Types</th><th class="py-1.5">Description</th></tr></thead>
            <tbody>${catRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Data Quality -->
      <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
        <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Data Quality</h4>
        <div class="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div class="text-gray-500">Classification Coverage</div>
            <div class="text-lg font-semibold text-gray-200">${pctClassified}%</div>
            <div class="text-xs text-gray-500">${classified} of ${total} markets classified</div>
          </div>
          <div>
            <div class="text-gray-500">Market Count</div>
            <div class="text-lg font-semibold text-gray-200">${total}</div>
            <div class="text-xs text-gray-500">Active markets scored</div>
          </div>
          <div>
            <div class="text-gray-500">Data Freshness</div>
            <div class="text-lg font-semibold text-gray-200">${DATA.latest.date || '--'}</div>
            <div class="text-xs text-gray-500">Last snapshot date</div>
          </div>
        </div>
      </div>

      <!-- Reference Data Comparison -->
      ${meth.reference_data ? `
      <div class="bg-gray-900/50 rounded-xl p-5 border border-gray-800/50">
        <h4 class="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Reference Data Sources</h4>
        <div class="text-sm text-gray-400 space-y-1">
          <div><span class="text-gray-300">BTC Price:</span> ${meth.reference_data.btc_price}</div>
          <div><span class="text-gray-300">Fear &amp; Greed:</span> ${meth.reference_data.fear_greed}</div>
        </div>
        <p class="text-xs text-gray-500 mt-3">The Fear &amp; Greed Index is an independent measure based on volatility, volume, social media, surveys, and dominance. Overlaying it with the Polymarket composite reveals divergences between prediction-market sentiment and traditional fear/greed signals.</p>
      </div>` : ''}

      <div class="text-xs text-gray-600">
        Data source: ${meth.data_source} &middot; Updated: ${meth.update_frequency} &middot; Generated: ${DATA.meta.generated_at || '--'}
      </div>
    </div>
  `;
}

// ── Shared Scoring Utilities (used by builder.js) ───────────────────────

const SIGNAL_K = 3.0;
const RESOLVED_LOW = 0.02;
const RESOLVED_HIGH = 0.98;
const NOISE_RE = /\bup or down\b/i;

function computeSignal(prob, polarity, compressed) {
  if (polarity === 'neutral') return 0;
  if (compressed) {
    const x = polarity === 'bullish' ? (prob - 0.5) : (0.5 - prob);
    return Math.tanh(SIGNAL_K * x);
  }
  // Linear fallback
  return polarity === 'bullish' ? (prob - 0.5) * 2 : (0.5 - prob) * 2;
}

function isResolved(prob) {
  return prob <= RESOLVED_LOW || prob >= RESOLVED_HIGH;
}

function isNoiseMarket(question) {
  return NOISE_RE.test(question);
}

// ── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
