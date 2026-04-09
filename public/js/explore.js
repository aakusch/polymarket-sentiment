// ── Explore Page — Public Indicator Discovery ──────────────────────────────

let exploreState = {
  indicators: [],
  sort: 'score',
  sector: '',
  loaded: false,
};

async function renderExplorePage() {
  const el = document.getElementById('page-explore');
  if (!el) return;

  if (!exploreState.loaded) {
    el.innerHTML = `
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-light text-gray-300 tracking-wide">Explore</h1>
        <div class="flex items-center gap-2">
          <select id="explore-sector" onchange="filterExploreSector(this.value)"
            class="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none">
            <option value="">All Sectors</option>
            <option value="crypto">Crypto</option>
          </select>
          <select id="explore-sort" onchange="sortExploreBy(this.value)"
            class="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-300 focus:outline-none">
            <option value="score">Top Score</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      <div id="explore-grid" class="text-sm text-gray-500">Loading public indicators...</div>`;
    await loadExploreIndicators();
  }
}

async function loadExploreIndicators() {
  try {
    const params = new URLSearchParams({ sort: exploreState.sort, limit: '50' });
    if (exploreState.sector) params.set('sector', exploreState.sector);

    const res = await fetch('/api/indicators/public?' + params);
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    exploreState.indicators = data.indicators || [];
    exploreState.loaded = true;
    renderExploreGrid();
  } catch (err) {
    const el = document.getElementById('explore-grid');
    if (el) el.innerHTML = `<div class="text-red-400 text-sm">Failed to load indicators: ${err.message}</div>`;
  }
}

function renderExploreGrid() {
  const el = document.getElementById('explore-grid');
  if (!el) return;

  if (exploreState.indicators.length === 0) {
    el.innerHTML = `
      <div class="bg-gray-900/50 rounded-2xl p-8 border border-gray-800/50 text-center">
        <div class="text-gray-400 mb-2">No public indicators yet</div>
        <p class="text-gray-500 text-sm mb-4">Be the first to build and share an indicator.</p>
        <a href="#builder" class="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">Build &rarr;</a>
      </div>`;
    return;
  }

  let html = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">';
  for (const ind of exploreState.indicators) {
    const scoreStr = ind.score != null ? ind.score.toFixed(1) : '--';
    const color = ind.score != null ? scoreColor(ind.score) : '#6b7280';
    const labelStr = ind.label || 'N/A';

    html += `
      <div class="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50 hover:border-gray-700/50 transition-colors">
        <div class="flex items-start justify-between mb-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-medium text-gray-200 truncate">${escapeHtml(ind.name)}</h3>
            <p class="text-xs text-gray-500 mt-0.5">by ${escapeHtml(ind.creator)}</p>
          </div>
          <div class="text-right ml-3">
            <div class="text-lg font-bold tabular-nums" style="color:${color}">${scoreStr}</div>
            <div class="text-xs text-gray-500">${labelStr}</div>
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-500 mb-3">
          <span class="px-2 py-0.5 bg-gray-800 rounded">${escapeHtml(ind.asset)}</span>
          <span>${ind.marketCount} market${ind.marketCount !== 1 ? 's' : ''}</span>
          ${ind.fgEnabled ? '<span class="text-green-500">F&G</span>' : ''}
        </div>
        <div class="flex items-center gap-2">
          <a href="/i/${ind.id}" class="text-xs text-gray-400 hover:text-gray-200 transition-colors">View</a>
          <span class="text-gray-700">&middot;</span>
          <button onclick="forkIndicator('${ind.id}')" class="text-xs text-blue-400 hover:text-blue-300 transition-colors">Fork in Builder</button>
        </div>
      </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// forkIndicator() is now defined in sandbox.js as the global version

function sortExploreBy(sort) {
  exploreState.sort = sort;
  exploreState.loaded = false;
  renderExplorePage();
}

function filterExploreSector(sector) {
  exploreState.sector = sector;
  exploreState.loaded = false;
  renderExplorePage();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
