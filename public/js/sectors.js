// ── Sector Registry ────────────────────────────────────────────────────────

const SECTORS = {
  crypto: {
    label: 'Crypto',
    description: 'Prediction markets on cryptocurrency prices, regulation, adoption, and events.',
    available: true,
    entityLabel: 'Asset',
    categories: {
      price_targets: { label: 'Price Targets', accent: '#f97316' },
      regulatory:    { label: 'Regulatory',    accent: '#a78bfa' },
      adoption:      { label: 'Adoption',      accent: '#2dd4bf' },
      events:        { label: 'Events',        accent: '#fb7185' },
      other:         { label: 'Other',         accent: '#6b7280' },
    },
    referenceData: {
      priceKey: 'btc_price',
      priceLabel: 'BTC Price',
      externalSignals: [
        { id: 'fear_greed', label: 'Fear & Greed Index', key: 'fear_greed' },
      ],
    },
    presets: {
      'Default': {
        selectCategories: ['price_targets', 'regulatory', 'adoption', 'events'],
        defaultWeight: 100, fgEnabled: false, fgWeight: 30,
      },
      'Price Only': {
        selectCategories: ['price_targets'],
        defaultWeight: 200, fgEnabled: false, fgWeight: 30,
      },
      'Regulatory Heavy': {
        selectCategories: ['price_targets', 'regulatory', 'adoption', 'events'],
        defaultWeight: 50, fgEnabled: false, fgWeight: 30,
        // Override: regulatory markets get 200
        categoryWeights: { regulatory: 200 },
      },
      'Contrarian F&G': {
        selectCategories: ['price_targets', 'regulatory', 'adoption', 'events'],
        defaultWeight: 100, fgEnabled: true, fgWeight: 70,
      },
    },
    dataFiles: { sandbox: 'data/sandbox.json', latest: 'data/latest.json' },
  },
  politics: {
    label: 'Politics',
    description: 'Elections, legislation, and geopolitical prediction markets.',
    available: true,
    entityLabel: 'Party/Branch',
    categories: {
      favors_incumbent:    { label: 'Favors Incumbent', accent: '#3b82f6' },
      favors_challenger:   { label: 'Favors Challenger', accent: '#ef4444' },
      legislative:         { label: 'Legislative',      accent: '#a78bfa' },
      judicial:            { label: 'Judicial',          accent: '#f97316' },
      geopolitical:        { label: 'Geopolitical',      accent: '#2dd4bf' },
      other:               { label: 'Other',             accent: '#6b7280' },
    },
    referenceData: {
      priceKey: null,
      priceLabel: null,
      externalSignals: [],
    },
    presets: {
      'Default': {
        selectCategories: ['favors_incumbent', 'favors_challenger', 'legislative', 'judicial', 'geopolitical'],
        defaultWeight: 100, fgEnabled: false, fgWeight: 30,
      },
      'Election Focus': {
        selectCategories: ['favors_incumbent', 'favors_challenger'],
        defaultWeight: 150, fgEnabled: false, fgWeight: 30,
      },
      'Policy Focus': {
        selectCategories: ['legislative', 'judicial', 'geopolitical'],
        defaultWeight: 100, fgEnabled: false, fgWeight: 30,
      },
    },
    dataFiles: { sandbox: 'data/sandbox-politics.json', latest: 'data/latest-politics.json' },
  },
  stocks: {
    label: 'Stocks',
    description: 'Equity index and individual stock price prediction markets.',
    available: true,
    entityLabel: 'Ticker',
    categories: {
      price_targets: { label: 'Price Targets', accent: '#f97316' },
      earnings:      { label: 'Earnings',      accent: '#a78bfa' },
      corporate:     { label: 'Corporate',     accent: '#2dd4bf' },
      other:         { label: 'Other',         accent: '#6b7280' },
    },
    referenceData: {
      priceKey: 'spx_price',
      priceLabel: 'S&P 500',
      externalSignals: [],
    },
    presets: {
      'Default': {
        selectCategories: ['price_targets', 'earnings', 'corporate'],
        defaultWeight: 100, fgEnabled: false, fgWeight: 30,
      },
      'Price Only': {
        selectCategories: ['price_targets'],
        defaultWeight: 200, fgEnabled: false, fgWeight: 30,
      },
      'Earnings Focus': {
        selectCategories: ['price_targets', 'earnings'],
        defaultWeight: 50, fgEnabled: false, fgWeight: 30,
        categoryWeights: { earnings: 200 },
      },
    },
    dataFiles: { sandbox: 'data/sandbox-stocks.json', latest: 'data/latest-stocks.json' },
  },
  economy: {
    label: 'Economy',
    description: 'Fed policy, inflation, recession probability, and employment markets.',
    available: true,
    entityLabel: 'Topic',
    categories: {
      monetary_policy: { label: 'Monetary Policy', accent: '#3b82f6' },
      inflation:       { label: 'Inflation',       accent: '#ef4444' },
      growth:          { label: 'Growth',           accent: '#22c55e' },
      employment:      { label: 'Employment',       accent: '#f97316' },
      other:           { label: 'Other',            accent: '#6b7280' },
    },
    referenceData: {
      priceKey: null,
      priceLabel: null,
      externalSignals: [],
    },
    presets: {
      'Default': {
        selectCategories: ['monetary_policy', 'inflation', 'growth', 'employment'],
        defaultWeight: 100, fgEnabled: false, fgWeight: 30,
      },
      'Fed Focus': {
        selectCategories: ['monetary_policy'],
        defaultWeight: 200, fgEnabled: false, fgWeight: 30,
      },
      'Growth & Jobs': {
        selectCategories: ['growth', 'employment'],
        defaultWeight: 150, fgEnabled: false, fgWeight: 30,
      },
    },
    dataFiles: { sandbox: 'data/sandbox-economy.json', latest: 'data/latest-economy.json' },
  },
};

const SECTOR_ORDER = ['crypto', 'stocks', 'economy', 'politics'];

// ── Chart Colors (moved from chart.js) ────────────────────────────────────

const LINE_COLORS = {
  composite:           { border: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
  btc_price:           { border: '#9ca3af', bg: 'rgba(156,163,175,0.05)' },
  fear_greed:          { border: '#22c55e', bg: 'rgba(34,197,94,0.05)' },
  price_targets:       { border: '#f97316', bg: 'rgba(249,115,22,0.05)' },
  regulatory:          { border: '#a78bfa', bg: 'rgba(167,139,250,0.05)' },
  adoption:            { border: '#2dd4bf', bg: 'rgba(45,212,191,0.05)' },
  events:              { border: '#fb7185', bg: 'rgba(251,113,133,0.05)' },
  favors_incumbent:    { border: '#3b82f6', bg: 'rgba(59,130,246,0.05)' },
  favors_challenger:   { border: '#ef4444', bg: 'rgba(239,68,68,0.05)' },
  legislative:         { border: '#a78bfa', bg: 'rgba(167,139,250,0.05)' },
  judicial:            { border: '#f97316', bg: 'rgba(249,115,22,0.05)' },
  geopolitical:        { border: '#2dd4bf', bg: 'rgba(45,212,191,0.05)' },
  // stocks
  earnings:            { border: '#a78bfa', bg: 'rgba(167,139,250,0.05)' },
  corporate:           { border: '#2dd4bf', bg: 'rgba(45,212,191,0.05)' },
  // economy
  monetary_policy:     { border: '#3b82f6', bg: 'rgba(59,130,246,0.05)' },
  inflation:           { border: '#ef4444', bg: 'rgba(239,68,68,0.05)' },
  growth:              { border: '#22c55e', bg: 'rgba(34,197,94,0.05)' },
  employment:          { border: '#f97316', bg: 'rgba(249,115,22,0.05)' },
  spx_price:           { border: '#9ca3af', bg: 'rgba(156,163,175,0.05)' },
};

// ── Neutral Line Plugin (moved from chart.js) ────────────────────────────

const neutralLinePlugin = {
  id: 'neutralLine',
  beforeDraw(chart) {
    const ctx = chart.ctx;
    const yScale = chart.scales.y;
    const xScale = chart.scales.x;
    if (!yScale || !xScale) return;
    const y = yScale.getPixelForValue(50);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.moveTo(xScale.left, y);
    ctx.lineTo(xScale.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px system-ui';
    ctx.fillText('Neutral', xScale.right + 6, y + 4);
    ctx.restore();
  },
};
