// ── Dual-Axis Time Series Chart (Chart.js) ───────────────────────────────

let chartInstance = null;

const LINE_COLORS = {
  composite:     { border: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
  btc_price:     { border: '#9ca3af', bg: 'rgba(156,163,175,0.05)' },
  fear_greed:    { border: '#22c55e', bg: 'rgba(34,197,94,0.05)' },
  price_targets: { border: '#f97316', bg: 'rgba(249,115,22,0.05)' },
  regulatory:    { border: '#a78bfa', bg: 'rgba(167,139,250,0.05)' },
  adoption:      { border: '#2dd4bf', bg: 'rgba(45,212,191,0.05)' },
  events:        { border: '#fb7185', bg: 'rgba(251,113,133,0.05)' },
};

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

function initChart(data) {
  const ctx = document.getElementById('sentiment-chart').getContext('2d');
  const labels = data.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const hasBTC = data.some(d => d.btc_price != null);
  const hasFNG = data.some(d => d.fear_greed != null);

  const datasets = [
    // Composite sentiment (left Y-axis)
    {
      label: 'Composite',
      data: data.map(d => d.normalized),
      borderColor: LINE_COLORS.composite.border,
      backgroundColor: LINE_COLORS.composite.bg,
      borderWidth: 2.5,
      fill: true,
      tension: 0.3,
      pointRadius: data.length > 30 ? 0 : 3,
      pointHoverRadius: 6,
      yAxisID: 'y',
    },
  ];

  // BTC Price (right Y-axis)
  if (hasBTC) {
    datasets.push({
      label: 'BTC Price',
      data: data.map(d => d.btc_price || null),
      borderColor: LINE_COLORS.btc_price.border,
      backgroundColor: LINE_COLORS.btc_price.bg,
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'y2',
    });
  }

  // Fear & Greed (left Y-axis, same 0-100 scale)
  if (hasFNG) {
    datasets.push({
      label: 'Fear & Greed',
      data: data.map(d => d.fear_greed || null),
      borderColor: LINE_COLORS.fear_greed.border,
      backgroundColor: LINE_COLORS.fear_greed.bg,
      borderWidth: 1.5,
      borderDash: [3, 3],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'y',
      hidden: true,
    });
  }

  // Sub-category lines (left Y-axis, hidden by default)
  const subCats = ['price_targets', 'regulatory', 'adoption', 'events'];
  subCats.forEach(cat => {
    datasets.push({
      label: cat.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()),
      data: data.map(d => (d.sub_scores && d.sub_scores[cat]) || 50),
      borderColor: LINE_COLORS[cat].border,
      backgroundColor: LINE_COLORS[cat].bg,
      borderWidth: 1.5,
      borderDash: [5, 3],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5,
      yAxisID: 'y',
      hidden: true,
    });
  });

  const scales = {
    y: {
      type: 'linear',
      position: 'left',
      min: 0,
      max: 100,
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: {
        color: '#6b7280',
        font: { size: 11 },
        callback: v => v,
      },
      title: {
        display: true,
        text: 'Sentiment (0-100)',
        color: '#6b7280',
        font: { size: 11 },
      },
    },
    x: {
      grid: { display: false },
      ticks: {
        color: '#6b7280',
        font: { size: 11 },
        maxRotation: 0,
        maxTicksLimit: 12,
      },
    },
  };

  // Right Y-axis for BTC price
  if (hasBTC) {
    const btcPrices = data.map(d => d.btc_price).filter(p => p != null);
    const btcMin = Math.min(...btcPrices);
    const btcMax = Math.max(...btcPrices);
    const padding = (btcMax - btcMin) * 0.1 || 5000;
    scales.y2 = {
      type: 'linear',
      position: 'right',
      min: Math.floor((btcMin - padding) / 1000) * 1000,
      max: Math.ceil((btcMax + padding) / 1000) * 1000,
      grid: { display: false },
      ticks: {
        color: '#9ca3af',
        font: { size: 11 },
        callback: v => '$' + (v / 1000).toFixed(0) + 'K',
      },
      title: {
        display: true,
        text: 'BTC Price (USD)',
        color: '#9ca3af',
        font: { size: 11 },
      },
    };
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    plugins: [neutralLinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
                return `${ds.label}: $${val.toLocaleString()}`;
              }
              return `${ds.label}: ${val.toFixed(1)}/100`;
            },
          },
        },
      },
      scales,
      layout: { padding: { right: hasBTC ? 0 : 50 } },
    },
  });
}
