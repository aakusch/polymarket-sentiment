// ── Custom Indicator Builder ──────────────────────────────────────────────

let builderState = {
  selections: new Map(),    // market id -> bool (included)
  sortKey: 'weight',
  sortDir: -1,
  visibleCount: 50,
  filters: { category: 'all', polarity: 'all', asset: 'all', search: '' },
  initialized: false,
};

const BUILDER_CAT_COLORS = {
  price_targets: 'bg-orange-500/20 text-orange-300',
  regulatory:    'bg-purple-500/20 text-purple-300',
  adoption:      'bg-teal-500/20 text-teal-300',
  events:        'bg-pink-500/20 text-pink-300',
  unclassified:  'bg-gray-500/20 text-gray-400',
};

const BUILDER_CAT_LABELS = {
  price_targets: 'Price',
  regulatory:    'Reg',
  adoption:      'Adopt',
  events:        'Event',
  unclassified:  'Other',
};

// ── Init ─────────────────────────────────────────────────────────────────

function renderBuilderPage() {
  if (!DATA.latest) return;
  const markets = DATA.latest.markets || [];

  if (!builderState.initialized) {
    // Default: all markets selected
    markets.forEach(m => {
      if (!builderState.selections.has(m.id)) {
        builderState.selections.set(m.id, true);
      }
    });
    builderState.initialized = true;
  }

  _renderBuilderFilters();
  _renderBuilderTable();
  builderRecompute();
}

// ── Filters ──────────────────────────────────────────────────────────────

function _renderBuilderFilters() {
  const el = document.getElementById('builder-filters');
  if (!el) return;
  const markets = DATA.latest.markets || [];
  const cats = ['all', 'price_targets', 'regulatory', 'adoption', 'events', 'unclassified'];
  const catLabels = { all: 'All', price_targets: 'Price Target', regulatory: 'Regulatory', adoption: 'Adoption', events: 'Event', unclassified: 'Other' };
  const assets = ['all', ...new Set(markets.map(m => m.asset || 'OTHER'))].filter((v, i, a) => a.indexOf(v) === i).sort();
  const sortedAssets = ['all', ...assets.filter(a => a !== 'all' && a !== 'OTHER'), 'OTHER'].filter((v, i, a) => a.indexOf(v) === i);

  el.innerHTML = `
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="text-xs text-gray-500 mr-1">Cat:</span>
        ${cats.map(c => `
          <button onclick="builderFilterCat('${c}')"
            class="px-2 py-1 rounded text-xs font-medium transition-colors
              ${c === builderState.filters.category ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
            ${catLabels[c]}
          </button>
        `).join('')}
      </div>
      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="text-xs text-gray-500 mr-1">Asset:</span>
        ${sortedAssets.map(a => `
          <button onclick="builderFilterAsset('${a}')"
            class="px-2 py-1 rounded text-xs font-medium transition-colors
              ${a === builderState.filters.asset ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}">
            ${a === 'all' ? 'All' : a}
          </button>
        `).join('')}
      </div>
      <div class="flex gap-2 items-center">
        <input type="text" placeholder="Search markets..." value="${builderState.filters.search}"
          oninput="builderFilterSearch(this.value)"
          class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1 text-sm text-gray-300 placeholder-gray-600 w-48 focus:outline-none focus:border-gray-500">
      </div>
    </div>
  `;
}

function builderFilterCat(cat) {
  builderState.filters.category = cat;
  builderState.visibleCount = 50;
  _renderBuilderFilters();
  _renderBuilderTable();
}

function builderFilterAsset(asset) {
  builderState.filters.asset = asset;
  builderState.visibleCount = 50;
  _renderBuilderFilters();
  _renderBuilderTable();
}

function builderFilterSearch(val) {
  builderState.filters.search = val.toLowerCase();
  builderState.visibleCount = 50;
  _renderBuilderTable();
}

// ── Sorting ──────────────────────────────────────────────────────────────

function builderSort(key) {
  if (builderState.sortKey === key) {
    builderState.sortDir *= -1;
  } else {
    builderState.sortKey = key;
    builderState.sortDir = -1;
  }
  _renderBuilderTable();
}

// ── Table ────────────────────────────────────────────────────────────────

function _getFilteredBuilderMarkets() {
  const markets = DATA.latest.markets || [];
  const f = builderState.filters;
  return markets
    .filter(m => f.category === 'all' || m.category === f.category)
    .filter(m => f.polarity === 'all' || m.polarity === f.polarity)
    .filter(m => f.asset === 'all' || (m.asset || 'OTHER') === f.asset)
    .filter(m => !f.search || m.question.toLowerCase().includes(f.search))
    .sort((a, b) => {
      const av = typeof a[builderState.sortKey] === 'string' ? a[builderState.sortKey] : (a[builderState.sortKey] || 0);
      const bv = typeof b[builderState.sortKey] === 'string' ? b[builderState.sortKey] : (b[builderState.sortKey] || 0);
      if (av < bv) return builderState.sortDir;
      if (av > bv) return -builderState.sortDir;
      return 0;
    });
}

function _renderBuilderTable() {
  const filtered = _getFilteredBuilderMarkets();
  const visible = filtered.slice(0, builderState.visibleCount);
  const tbody = document.getElementById('builder-tbody');
  const countEl = document.getElementById('builder-selected-count');
  if (!tbody) return;

  const totalSelected = [...builderState.selections.values()].filter(Boolean).length;
  const totalMarkets = (DATA.latest.markets || []).length;
  countEl.textContent = `${totalSelected} / ${totalMarkets} selected`;

  // Sort arrows
  document.querySelectorAll('[data-bsort]').forEach(th => {
    const key = th.dataset.bsort;
    const arrow = builderState.sortKey === key ? (builderState.sortDir === -1 ? ' \u25BC' : ' \u25B2') : '';
    th.querySelector('.bsort-arrow').textContent = arrow;
  });

  tbody.innerHTML = visible.map(m => {
    const checked = builderState.selections.get(m.id) !== false;
    const catClass = BUILDER_CAT_COLORS[m.category] || BUILDER_CAT_COLORS.unclassified;
    const catLabel = BUILDER_CAT_LABELS[m.category] || '?';
    const sigColor = m.signal > 0.1 ? 'text-green-400' : m.signal < -0.1 ? 'text-red-400' : 'text-gray-400';
    return `
      <tr class="border-b border-gray-800/50 hover:bg-gray-800/30 ${checked ? '' : 'opacity-40'}">
        <td class="py-2 pr-2"><input type="checkbox" ${checked ? 'checked' : ''} onchange="builderToggle('${m.id}', this.checked)" class="rounded bg-gray-700 border-gray-600"></td>
        <td class="py-2 pr-3 text-xs text-gray-300 max-w-xs"><div class="truncate" title="${m.question}">${m.question}</div></td>
        <td class="py-2 px-3 text-xs text-gray-300 font-medium">${m.asset || 'OTHER'}</td>
        <td class="py-2 px-3"><span class="px-1.5 py-0.5 rounded text-xs ${catClass}">${catLabel}</span></td>
        <td class="py-2 px-3 text-xs ${m.polarity === 'bullish' ? 'text-green-400' : m.polarity === 'bearish' ? 'text-red-400' : 'text-gray-400'}">${m.polarity}</td>
        <td class="py-2 px-3 text-xs text-gray-300 tabular-nums">${(m.probability * 100).toFixed(1)}%</td>
        <td class="py-2 px-3 text-xs tabular-nums ${sigColor}">${m.signal > 0 ? '+' : ''}${m.signal.toFixed(3)}</td>
      </tr>
    `;
  }).join('');

  const showMore = document.getElementById('builder-show-more');
  if (filtered.length > builderState.visibleCount) {
    showMore.classList.remove('hidden');
    showMore.querySelector('span').textContent = `Show more (${builderState.visibleCount} of ${filtered.length})`;
  } else {
    showMore.classList.add('hidden');
  }
}

function builderShowMore() {
  builderState.visibleCount += 50;
  _renderBuilderTable();
}

// ── Selection Controls ───────────────────────────────────────────────────

function builderToggle(id, checked) {
  builderState.selections.set(id, checked);
  builderRecompute();
  _renderBuilderTable();
}

function builderToggleAllVisible(checked) {
  const filtered = _getFilteredBuilderMarkets();
  filtered.forEach(m => builderState.selections.set(m.id, checked));
  builderRecompute();
  _renderBuilderTable();
}

function builderSelectAll() {
  (DATA.latest.markets || []).forEach(m => builderState.selections.set(m.id, true));
  builderRecompute();
  _renderBuilderTable();
}

function builderDeselectAll() {
  (DATA.latest.markets || []).forEach(m => builderState.selections.set(m.id, false));
  builderRecompute();
  _renderBuilderTable();
}

function builderResetSelections() {
  (DATA.latest.markets || []).forEach(m => builderState.selections.set(m.id, true));
  // Reset options to defaults
  document.getElementById('opt-filterResolved').checked = true;
  document.getElementById('opt-filterNoise').checked = true;
  document.getElementById('opt-compressedSignal').checked = true;
  document.getElementById('opt-neutralUnclassified').checked = true;
  document.getElementById('opt-eventDedup').checked = true;
  builderRecompute();
  _renderBuilderTable();
}

// ── Options ──────────────────────────────────────────────────────────────

function _getBuilderOptions() {
  return {
    filterResolved: document.getElementById('opt-filterResolved')?.checked ?? true,
    filterNoise: document.getElementById('opt-filterNoise')?.checked ?? true,
    compressedSignal: document.getElementById('opt-compressedSignal')?.checked ?? true,
    neutralUnclassified: document.getElementById('opt-neutralUnclassified')?.checked ?? true,
    eventDedup: document.getElementById('opt-eventDedup')?.checked ?? true,
  };
}

// ── Compute ──────────────────────────────────────────────────────────────

function computeBuilderComposite() {
  const markets = DATA.latest.markets || [];
  const opts = _getBuilderOptions();

  // Filter to selected markets + apply option filters
  let active = markets.filter(m => builderState.selections.get(m.id) !== false);

  if (opts.filterResolved) {
    active = active.filter(m => !isResolved(m.probability));
  }
  if (opts.filterNoise) {
    active = active.filter(m => !isNoiseMarket(m.question));
  }

  // Recompute signals with current options
  const scored = active.map(m => {
    let polarity = m.polarity;
    if (opts.neutralUnclassified && m.classification === 'unclassified') {
      polarity = 'neutral';
    }
    const signal = computeSignal(m.probability, polarity, opts.compressedSignal);
    return { ...m, _signal: signal, _polarity: polarity };
  });

  // Composite (optionally event-deduped)
  let composite = 0;
  let marketCount = scored.length;

  if (opts.eventDedup && scored.length > 0) {
    const byEvent = {};
    scored.forEach(m => {
      const eid = m.event_id || m.id;
      if (!byEvent[eid]) byEvent[eid] = [];
      byEvent[eid].push(m);
    });

    let wSum = 0, wTotal = 0;
    for (const group of Object.values(byEvent)) {
      const gWSum = group.reduce((s, m) => s + m._signal * m.weight, 0);
      const gW = group.reduce((s, m) => s + m.weight, 0);
      if (gW > 0) {
        wSum += (gWSum / gW) * gW;
        wTotal += gW;
      }
    }
    composite = wTotal > 0 ? wSum / wTotal : 0;
  } else if (scored.length > 0) {
    const wSum = scored.reduce((s, m) => s + m._signal * m.weight, 0);
    const wTotal = scored.reduce((s, m) => s + m.weight, 0);
    composite = wTotal > 0 ? wSum / wTotal : 0;
  }

  // Sub-scores by category
  const subCategories = {
    price_targets: ['price_above', 'price_below', 'price_range'],
    regulatory: ['regulatory_positive', 'regulatory_negative'],
    adoption: ['adoption'],
    events: ['event_positive', 'event_negative'],
  };

  const subScores = {};
  for (const [catName, types] of Object.entries(subCategories)) {
    const catMarkets = scored.filter(m => types.includes(m.classification));
    if (catMarkets.length > 0) {
      const wSum = catMarkets.reduce((s, m) => s + m._signal * m.weight, 0);
      const wTotal = catMarkets.reduce((s, m) => s + m.weight, 0);
      subScores[catName] = {
        raw: wTotal > 0 ? wSum / wTotal : 0,
        count: catMarkets.length,
      };
    } else {
      subScores[catName] = { raw: 0, count: 0 };
    }
  }

  const normalized = (composite + 1) * 50;
  return { composite, normalized, marketCount, subScores };
}

function builderRecompute() {
  const result = computeBuilderComposite();
  const n = result.normalized;
  const color = scoreColor(n);
  const label = scoreLabel(n);

  // Update score display
  const scoreEl = document.getElementById('builder-score');
  const labelEl = document.getElementById('builder-label');
  const metaEl = document.getElementById('builder-meta');
  if (scoreEl) {
    scoreEl.textContent = n.toFixed(1);
    scoreEl.style.color = color;
  }
  if (labelEl) {
    labelEl.textContent = label;
    labelEl.style.color = color;
  }
  if (metaEl) {
    metaEl.textContent = `${result.marketCount} markets included`;
  }

  // Default comparison
  const defaultN = DATA.latest.normalized || 50;
  const compareEl = document.getElementById('builder-default-compare');
  if (compareEl) {
    const diff = n - defaultN;
    const arrow = diff > 0 ? '+' : '';
    compareEl.innerHTML = `Default score: <span style="color:${scoreColor(defaultN)}">${defaultN.toFixed(1)}</span> &middot; <span class="${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-gray-400'}">${arrow}${diff.toFixed(1)} pts</span>`;
  }

  // Category bars
  const catBarsEl = document.getElementById('builder-cat-bars');
  if (catBarsEl) {
    const catLabels = { price_targets: 'Price Targets', regulatory: 'Regulatory', adoption: 'Adoption', events: 'Events' };
    catBarsEl.innerHTML = Object.entries(result.subScores).map(([cat, data]) => {
      const catN = (data.raw + 1) * 50;
      const catColor = scoreColor(catN);
      return `
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-gray-400">${catLabels[cat] || cat}</span>
            <span class="text-xs tabular-nums" style="color:${catColor}">${catN.toFixed(1)} <span class="text-gray-600">(${data.count})</span></span>
          </div>
          <div class="bg-gray-800 rounded-full h-2 relative overflow-hidden">
            <div class="absolute inset-y-0 left-0 rounded-full transition-all" style="width:${catN}%;background:${catColor}"></div>
            <div class="absolute inset-y-0 left-1/2 w-px bg-gray-600"></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ── Presets (localStorage) ───────────────────────────────────────────────

function builderSavePreset() {
  const name = prompt('Preset name:');
  if (!name) return;

  const presets = JSON.parse(localStorage.getItem('pcsi_builder_presets') || '{}');
  presets[name] = {
    selections: Object.fromEntries(builderState.selections),
    options: _getBuilderOptions(),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem('pcsi_builder_presets', JSON.stringify(presets));
}

function builderLoadPreset() {
  const presets = JSON.parse(localStorage.getItem('pcsi_builder_presets') || '{}');
  const names = Object.keys(presets);
  if (names.length === 0) {
    alert('No saved presets.');
    return;
  }

  const name = prompt('Load preset:\n' + names.map((n, i) => `${i + 1}. ${n}`).join('\n') + '\n\nEnter name:');
  if (!name || !presets[name]) return;

  const preset = presets[name];

  // Restore selections
  const entries = Object.entries(preset.selections);
  entries.forEach(([id, val]) => builderState.selections.set(id, val));

  // Restore options
  if (preset.options) {
    const optMap = {
      filterResolved: 'opt-filterResolved',
      filterNoise: 'opt-filterNoise',
      compressedSignal: 'opt-compressedSignal',
      neutralUnclassified: 'opt-neutralUnclassified',
      eventDedup: 'opt-eventDedup',
    };
    for (const [key, elId] of Object.entries(optMap)) {
      const el = document.getElementById(elId);
      if (el && preset.options[key] !== undefined) el.checked = preset.options[key];
    }
  }

  builderRecompute();
  _renderBuilderTable();
}
