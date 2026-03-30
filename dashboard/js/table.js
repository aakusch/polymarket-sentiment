// ── Market Explorer Table ─────────────────────────────────────────────────

let allMarkets = [];
let filters = { category: 'all', polarity: 'all', asset: 'all', search: '' };
let sortKey = 'weight';
let sortDir = -1; // -1 = desc
let visibleCount = 25;

const CAT_COLORS = {
  price_targets: 'bg-orange-500/20 text-orange-300',
  regulatory:    'bg-purple-500/20 text-purple-300',
  adoption:      'bg-teal-500/20 text-teal-300',
  events:        'bg-pink-500/20 text-pink-300',
  unclassified:  'bg-gray-500/20 text-gray-400',
};

const CAT_LABELS = {
  price_targets: 'Price Target',
  regulatory:    'Regulatory',
  adoption:      'Adoption',
  events:        'Event',
  unclassified:  'Other',
};

function initTable(markets, preFilters) {
  allMarkets = markets;
  filters = { category: 'all', polarity: 'all', asset: 'all', search: '' };
  visibleCount = 25;

  if (preFilters) {
    if (preFilters.category) filters.category = preFilters.category;
    if (preFilters.asset) filters.asset = preFilters.asset;
  }

  renderFilters();
  renderTable();
}

function filterByCategory(cat) {
  filters.category = cat;
  visibleCount = 25;
  _updateFilterButtons();
  renderTable();
  document.getElementById('page-markets')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterByAsset(asset) {
  filters.asset = asset;
  visibleCount = 25;
  _updateAssetButtons();
  renderTable();
}

function _updateFilterButtons() {
  document.querySelectorAll('[data-cat-filter]').forEach(btn => {
    btn.classList.toggle('bg-blue-600', btn.dataset.catFilter === filters.category);
    btn.classList.toggle('text-white', btn.dataset.catFilter === filters.category);
    btn.classList.toggle('bg-gray-700', btn.dataset.catFilter !== filters.category);
    btn.classList.toggle('text-gray-300', btn.dataset.catFilter !== filters.category);
  });
}

function _updateAssetButtons() {
  document.querySelectorAll('[data-asset-filter]').forEach(btn => {
    btn.classList.toggle('bg-blue-600', btn.dataset.assetFilter === filters.asset);
    btn.classList.toggle('text-white', btn.dataset.assetFilter === filters.asset);
    btn.classList.toggle('bg-gray-700', btn.dataset.assetFilter !== filters.asset);
    btn.classList.toggle('text-gray-300', btn.dataset.assetFilter !== filters.asset);
  });
}

function renderFilters() {
  const el = document.getElementById('table-filters');
  const cats = ['all', 'price_targets', 'regulatory', 'adoption', 'events', 'unclassified'];
  const catLabels = { all: 'All', ...CAT_LABELS };

  // Get unique assets from the data
  const assets = ['all', ...new Set(allMarkets.map(m => m.asset || 'OTHER').filter(a => a))].sort();
  // Move 'all' to front, 'OTHER' to end
  const sortedAssets = ['all', ...assets.filter(a => a !== 'all' && a !== 'OTHER'), 'OTHER'].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  el.innerHTML = `
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="text-xs text-gray-500 mr-1">Category:</span>
        ${cats.map(c => `
          <button data-cat-filter="${c}" onclick="filterByCategory('${c}')"
            class="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
              ${c === filters.category ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
            ${catLabels[c]}
          </button>
        `).join('')}
      </div>
      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="text-xs text-gray-500 mr-1">Asset:</span>
        ${sortedAssets.map(a => `
          <button data-asset-filter="${a}" onclick="filterByAsset('${a}')"
            class="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
              ${a === filters.asset ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
            ${a === 'all' ? 'All' : a}
          </button>
        `).join('')}
      </div>
      <div class="flex gap-2 items-center">
        <button onclick="togglePolarity()" id="polarity-btn"
          class="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
          Polarity: ${filters.polarity.charAt(0).toUpperCase() + filters.polarity.slice(1)}
        </button>
        <input type="text" placeholder="Search markets..."
          oninput="onSearch(this.value)"
          class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1 text-sm text-gray-300 placeholder-gray-600 w-48 focus:outline-none focus:border-gray-500">
      </div>
    </div>
  `;
}

function togglePolarity() {
  const cycle = ['all', 'bullish', 'bearish'];
  const idx = cycle.indexOf(filters.polarity);
  filters.polarity = cycle[(idx + 1) % cycle.length];
  visibleCount = 25;
  const btn = document.getElementById('polarity-btn');
  btn.textContent = 'Polarity: ' + filters.polarity.charAt(0).toUpperCase() + filters.polarity.slice(1);
  renderTable();
}

function onSearch(val) {
  filters.search = val.toLowerCase();
  visibleCount = 25;
  renderTable();
}

function sortTable(key) {
  if (sortKey === key) {
    sortDir *= -1;
  } else {
    sortKey = key;
    sortDir = -1;
  }
  renderTable();
}

function applyFilters() {
  return allMarkets
    .filter(m => filters.category === 'all' || m.category === filters.category)
    .filter(m => filters.polarity === 'all' || m.polarity === filters.polarity)
    .filter(m => filters.asset === 'all' || (m.asset || 'OTHER') === filters.asset)
    .filter(m => !filters.search || m.question.toLowerCase().includes(filters.search))
    .sort((a, b) => {
      const av = typeof a[sortKey] === 'string' ? a[sortKey] : (a[sortKey] || 0);
      const bv = typeof b[sortKey] === 'string' ? b[sortKey] : (b[sortKey] || 0);
      if (av < bv) return sortDir;
      if (av > bv) return -sortDir;
      return 0;
    });
}

function signalBar(signal) {
  const color = signal > 0.1 ? '#22c55e' : signal < -0.1 ? '#ef4444' : '#6b7280';
  return `
    <div class="flex items-center gap-2">
      <div class="w-16 bg-gray-700 rounded-full h-1.5 relative">
        <div class="absolute top-0 h-1.5 rounded-full" style="left:50%;width:${Math.abs(signal)*50}%;${signal < 0 ? 'transform:translateX(-100%);' : ''}background:${color}"></div>
        <div class="absolute top-0 left-1/2 w-px h-1.5 bg-gray-500"></div>
      </div>
      <span class="text-xs tabular-nums" style="color:${color}">${signal > 0 ? '+' : ''}${signal.toFixed(3)}</span>
    </div>
  `;
}

function renderTable() {
  const filtered = applyFilters();
  const visible = filtered.slice(0, visibleCount);
  const tbody = document.getElementById('markets-tbody');
  const count = document.getElementById('markets-count');

  count.textContent = `${filtered.length} market${filtered.length !== 1 ? 's' : ''}`;

  const sortArrow = (key) => sortKey === key ? (sortDir === -1 ? ' \u25BC' : ' \u25B2') : '';

  document.querySelectorAll('[data-sort]').forEach(th => {
    const key = th.dataset.sort;
    th.querySelector('.sort-arrow').textContent = sortArrow(key);
  });

  tbody.innerHTML = visible.map(m => {
    const catClass = CAT_COLORS[m.category] || CAT_COLORS.unclassified;
    const catLabel = CAT_LABELS[m.category] || 'Other';
    const asset = m.asset || 'OTHER';
    return `
      <tr class="border-b border-gray-800/50 hover:bg-gray-800/30">
        <td class="py-2.5 pr-3 text-sm text-gray-300 max-w-xs">
          <div class="truncate" title="${m.question}">${m.question}</div>
        </td>
        <td class="py-2.5 px-3 text-xs text-gray-300 font-medium">${asset}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-xs font-medium ${catClass}">${catLabel}</span>
        </td>
        <td class="py-2.5 px-3 text-xs ${m.polarity === 'bullish' ? 'text-green-400' : m.polarity === 'bearish' ? 'text-red-400' : 'text-gray-400'}">${m.polarity}</td>
        <td class="py-2.5 px-3 text-sm text-gray-300 tabular-nums">${(m.probability * 100).toFixed(1)}%</td>
        <td class="py-2.5 px-3">${signalBar(m.signal)}</td>
        <td class="py-2.5 px-3 text-sm text-gray-400 tabular-nums">${m.weight.toFixed(3)}</td>
        <td class="py-2.5 pl-3 text-sm text-gray-400 tabular-nums text-right">${fmt$(m.volume_24h)}</td>
      </tr>
    `;
  }).join('');

  const showMore = document.getElementById('show-more');
  if (filtered.length > visibleCount) {
    showMore.classList.remove('hidden');
    showMore.querySelector('span').textContent = `Show more (${visibleCount} of ${filtered.length})`;
  } else {
    showMore.classList.add('hidden');
  }
}

function showMoreRows() {
  visibleCount += 25;
  renderTable();
}
