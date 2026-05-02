// ── Docs Page ───────────────────────────────────────────────────────────────

function renderDocsPage() {
  const el = document.getElementById('docs-content');
  if (!el) return;

  // Helpers
  const code = (t) => `<code class="text-[13px] text-blue-400 bg-gray-900/60 px-1.5 py-0.5 rounded font-mono">${t}</code>`;
  const codeBlock = (lang, text) => `
    <div class="bg-gray-900/60 rounded-lg p-4 text-[13px] font-mono text-green-400 overflow-x-auto border border-gray-700/30 leading-relaxed">
      <div class="text-gray-500 text-[10px] uppercase tracking-wide mb-2">${lang}</div>
      <pre class="whitespace-pre-wrap">${text}</pre>
    </div>`;
  const formula = (text) => `
    <div class="bg-gray-900/60 rounded-lg px-4 py-3 font-mono text-sm text-amber-300/90 border border-gray-700/30 overflow-x-auto">${text}</div>`;

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'how-it-works', label: 'How It Works' },
    { id: 'score-formula', label: 'Score Formula' },
    { id: 'predictive', label: 'Predictive Score' },
    { id: 'backtest', label: 'Backtest Engine' },
    { id: 'backtest-metrics', label: 'Backtest Metrics' },
    { id: 'api', label: 'API Reference' },
    { id: 'pricing', label: 'Pricing' },
  ];

  // Sidebar
  const sidebar = `
    <nav class="hidden lg:block sticky top-20 shrink-0 w-48 self-start">
      <div class="text-[11px] text-gray-500 uppercase tracking-wide mb-3">On this page</div>
      <div class="space-y-1" id="docs-nav">
        ${sections.map(s => `
          <a href="javascript:void(0)" onclick="document.getElementById('doc-${s.id}')?.scrollIntoView({behavior:'smooth',block:'start'})" data-doc-nav="${s.id}"
            class="block px-3 py-1.5 text-[13px] text-gray-500 rounded-md hover:text-gray-200 hover:bg-gray-800/40 transition-colors truncate">${s.label}</a>
        `).join('')}
      </div>
    </nav>`;

  // Content
  let content = '';

  // Overview
  content += `
    <section id="doc-overview" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Overview</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-4">
        <p class="text-sm text-gray-300 leading-relaxed">Polymarket Signals Lab transforms prediction market data into quantitative and qualitative signals. Markets from Polymarket are classified, scored for sentiment, and aggregated into composite signals that can track assets, policy themes, elections, or related outcome markets.</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          ${[
            { name: 'Crypto', assets: 'BTC, ETH, SOL', cats: 'price_targets, regulatory, adoption, events' },
            { name: 'Stocks', assets: 'S&P 500, NDX', cats: 'price_targets, earnings, corporate' },
            { name: 'Economy', assets: 'Yields, Fed', cats: 'monetary_policy, inflation, growth, employment' },
            { name: 'Politics', assets: 'Elections', cats: 'incumbent, challenger, legislative, geopolitical' },
          ].map(s => `
            <div class="bg-gray-900/50 rounded-lg p-3">
              <div class="text-sm font-medium text-gray-200">${s.name}</div>
              <div class="text-[11px] text-gray-500 mt-1">${s.assets}</div>
              <div class="text-[10px] text-gray-600 mt-1 leading-relaxed">${s.cats}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>`;

  // How It Works
  content += `
    <section id="doc-how-it-works" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">How It Works</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-5">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          ${['Market Discovery', 'Classification', 'Sentiment Signal', 'Weighted Composite', 'Score 0\u2013100'].map((step, i) => `
            ${i > 0 ? '<span class="text-gray-600">\u2192</span>' : ''}
            <span class="px-3 py-1.5 rounded-lg bg-gray-900/50 border border-gray-700/30 text-gray-300">${step}</span>
          `).join('')}
        </div>
        <div class="space-y-3 text-sm text-gray-400 leading-relaxed">
          <p><strong class="text-gray-300">Market Discovery</strong> \u2014 Polymarket markets are fetched daily via the Gamma API using sector-specific search terms and tags.</p>
          <p><strong class="text-gray-300">Classification</strong> \u2014 Each market is classified into a category (e.g. price_targets, regulatory) with polarity (positive/negative) using LLM classification.</p>
          <p><strong class="text-gray-300">Sentiment Signal</strong> \u2014 Market probability and volume are converted into a sentiment signal from -1 (bearish) to +1 (bullish), weighted by liquidity.</p>
          <p><strong class="text-gray-300">Composite</strong> \u2014 User-selected markets are combined with custom weights into a single indicator score.</p>
        </div>
      </div>
    </section>`;

  // Score Formula
  content += `
    <section id="doc-score-formula" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Score Formula</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-5">
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Base score</div>
          ${formula('Score = (( &Sigma; w &middot; s &middot; wt ) / ( &Sigma; w &middot; wt ) + 1) &times; 50')}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-400">
          <div class="bg-gray-900/50 rounded-lg p-3"><strong class="text-gray-300">w</strong> \u2014 User weight per market (0\u2013200%)</div>
          <div class="bg-gray-900/50 rounded-lg p-3"><strong class="text-gray-300">s</strong> \u2014 Sentiment signal (-1 to +1)</div>
          <div class="bg-gray-900/50 rounded-lg p-3"><strong class="text-gray-300">wt</strong> \u2014 Market weight (liquidity-derived)</div>
        </div>
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">With Fear &amp; Greed blending</div>
          ${formula('Final = Score &times; (1 - blend) + FearGreed &times; blend')}
          <p class="text-xs text-gray-500 mt-2">Blend factor is user-configurable (default 30%). F&G index from Alternative.me, range 0\u2013100.</p>
        </div>
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Polarity flip</div>
          <p class="text-xs text-gray-400">Markets can be flipped to invert their signal. When flipped, the sentiment signal ${code('s')} is multiplied by ${code('-1')} before aggregation.</p>
        </div>
      </div>
    </section>`;

  // Predictive Score
  content += `
    <section id="doc-predictive" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Predictive Score</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-5">
        <p class="text-sm text-gray-400 leading-relaxed">Measures how well an indicator's scores lead future reference asset returns using lagged Pearson cross-correlation.</p>
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Method</div>
          <ol class="text-xs text-gray-400 space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>For each lag in ${code('[1, 2, 3, 5, 7, 14, 21, 30]')} days:</li>
            <li class="ml-4">Compute Pearson ${code('r')} between ${code('scores[i]')} and forward return ${code('prices[i + lag] / prices[i] - 1')}</li>
            <li class="ml-4">Require minimum 10 valid pairs per lag</li>
            <li>Track the strongest positive signed ${code('r')} and its corresponding lag</li>
          </ol>
        </div>
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Composite formula</div>
          ${formula('Predictive = max(0, peakCorr) &times; 100 &times; (0.7 + (1 - peakLag / 30) &times; 0.3)')}
          <p class="text-xs text-gray-500 mt-2">Negative correlations are reported but score 0 because they imply inverse direction. Shorter lags mildly increase positively correlated scores. Clamped to 0\u2013100.</p>
        </div>
        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Output</div>
          ${codeBlock('json', '{\n  "score": 72,           // 0-100 composite\n  "peakCorrelation": 0.54, // best r value (can be negative)\n  "optimalLag": 3          // days ahead the indicator leads\n}')}
        </div>
        <div class="flex gap-3 text-xs">
          <span class="px-2 py-1 rounded bg-green-900/30 text-green-400">&gt;60 Strong</span>
          <span class="px-2 py-1 rounded bg-yellow-900/30 text-yellow-400">&gt;40 Moderate</span>
          <span class="px-2 py-1 rounded bg-gray-800 text-gray-400">&le;40 Weak</span>
        </div>
      </div>
    </section>`;

  // Backtest Engine
  content += `
    <section id="doc-backtest" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Backtest Engine</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-6">

        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-3">Strategies</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
              <div class="text-sm font-medium text-gray-200 mb-2">Momentum</div>
              <div class="text-xs text-gray-400 space-y-1">
                <p><strong class="text-gray-300">Enter:</strong> score &ge; entry threshold</p>
                <p><strong class="text-gray-300">Exit:</strong> score &le; exit threshold</p>
                <p class="text-gray-500">Buy high conviction, sell on doubt.</p>
              </div>
            </div>
            <div class="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
              <div class="text-sm font-medium text-gray-200 mb-2">Contrarian</div>
              <div class="text-xs text-gray-400 space-y-1">
                <p><strong class="text-gray-300">Enter:</strong> score &le; entry threshold</p>
                <p><strong class="text-gray-300">Exit:</strong> score &ge; exit threshold</p>
                <p class="text-gray-500">Buy the dip, sell the rally.</p>
              </div>
            </div>
            <div class="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
              <div class="text-sm font-medium text-gray-200 mb-2">Long Only</div>
              <div class="text-xs text-gray-400 space-y-1">
                <p><strong class="text-gray-300">Enter:</strong> score &le; entry threshold</p>
                <p><strong class="text-gray-300">Exit:</strong> score &ge; exit threshold</p>
                <p class="text-gray-500">Buy cheap, hold for mean reversion.</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="text-xs text-gray-500 uppercase tracking-wide mb-2">Execution model</div>
          <div class="text-xs text-gray-400 space-y-2 leading-relaxed">
            <p>Trades execute on the same day the signal triggers. Position is binary \u2014 fully in or fully out.</p>
            <p><strong class="text-gray-300">Mark-to-market:</strong> While in position, equity updates daily based on price changes:</p>
            ${formula('equity *= (1 + (price[i] - price[i-1]) / price[i-1])')}
            <p><strong class="text-gray-300">Transaction costs:</strong> Applied as half the round-trip cost at entry and exit:</p>
            ${formula('halfCost = costBps / 20000<br>equity *= (1 - halfCost) &nbsp; // at each entry and exit')}
            <p><strong class="text-gray-300">Buy &amp; hold benchmark:</strong> Tracks a passive hold from the first valid data point:</p>
            ${formula('bhCurve[i] = price[i] / basePrice')}
          </div>
        </div>
      </div>
    </section>`;

  // Backtest Metrics
  content += `
    <section id="doc-backtest-metrics" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Backtest Metrics</h2>
      <div class="bg-gray-800/40 rounded-xl border border-gray-700/40 overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-gray-700/40 text-gray-400">
              <th class="text-left py-3 px-5 font-medium">Metric</th>
              <th class="text-left py-3 px-5 font-medium">Formula</th>
              <th class="text-left py-3 px-5 font-medium hidden sm:table-cell">Interpretation</th>
            </tr>
          </thead>
          <tbody class="text-gray-300">
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Return</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">(equity - 1) &times; 100%</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Total strategy P&L after all trades and costs</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Buy &amp; Hold</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">(lastPrice / firstPrice - 1) &times; 100%</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Passive benchmark return over the same period</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Alpha</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">Return - Buy&Hold</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Excess return vs simply holding the asset</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Sharpe</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">(mean(r) / stdev(r)) &times; &radic;252</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Risk-adjusted return. &gt;1 good, &gt;2 excellent</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Sortino</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">(mean(r) / downDev(r)) &times; &radic;252</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Like Sharpe but only penalizes downside volatility</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">CAGR</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">(equity ^ (252/days) - 1) &times; 100%</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Annualized compound growth rate</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Max Drawdown</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">max((peak - equity) / peak)</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Worst peak-to-trough decline during backtest</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Win Rate</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">wins / trades &times; 100%</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Percentage of trades that were profitable</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Profit Factor</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">grossProfit / grossLoss</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">&gt;1 profitable, &gt;2 strong edge</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Exposure</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">daysInPosition / totalDays &times; 100%</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">% of time the strategy held a position</td>
            </tr>
            <tr class="border-b border-gray-700/20">
              <td class="py-3 px-5 font-medium text-gray-200">Predictive</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">|peakR|&times;70 + (1-lag/30)&times;30</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">How well scores predict future price movement</td>
            </tr>
            <tr>
              <td class="py-3 px-5 font-medium text-gray-200">Peak Lag</td>
              <td class="py-3 px-5"><code class="text-amber-300/80">argmax(|r|) over lags</code></td>
              <td class="py-3 px-5 text-gray-500 hidden sm:table-cell">Days ahead where correlation is strongest</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-4 bg-gray-800/40 rounded-xl p-5 border border-gray-700/40 space-y-3">
        <div class="text-xs text-gray-500 uppercase tracking-wide">Sharpe &amp; Sortino detail</div>
        <div class="text-xs text-gray-400 space-y-2 leading-relaxed">
          <p>Daily returns are computed from the equity curve: ${code('r[i] = equity[i] / equity[i-1] - 1')}</p>
          <p><strong class="text-gray-300">Sharpe:</strong> Uses standard deviation of all daily returns. Annualized with &radic;252 (trading days).</p>
          <p><strong class="text-gray-300">Sortino:</strong> Downside deviation uses only negative returns, but divides by total count (not just negative count) to avoid bias:</p>
          ${formula('downDev = &radic;( &Sigma; min(r, 0)&sup2; / N )')}
          <p>Both require &gt;10 daily return observations to compute.</p>
        </div>
      </div>
    </section>`;

  // API Reference
  content += `
    <section id="doc-api" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">API Reference</h2>
      <div class="space-y-4">
        <div class="bg-gray-800/40 rounded-xl p-5 border border-gray-700/40 space-y-3">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Authentication</div>
          <p class="text-sm text-gray-400">All endpoints require an ${code('X-API-Key')} header. Create keys from the API panel after signing in.</p>
          ${codeBlock('bash', 'curl -H "X-API-Key: pmsi_your_key" https://pmsi.app/api/v2/indicators')}
        </div>

        ${[
          {
            method: 'GET', path: '/api/v2/indicators', credits: '0',
            desc: 'List public indicators with scores and metadata.',
            params: 'sort (score|newest|name), sector, asset, limit (1-100), offset',
          },
          {
            method: 'GET', path: '/api/v2/indicators/{id}/latest', credits: '1',
            desc: 'Current score, label, and predictive score for one indicator.',
            params: null,
          },
          {
            method: 'GET', path: '/api/v2/indicators/{id}/timeseries', credits: '1',
            desc: 'Full date-indexed timeseries with scores, prices, F&G values, and predictive score.',
            params: 'start (YYYY-MM-DD), end (YYYY-MM-DD)',
          },
        ].map(ep => `
          <div class="bg-gray-800/40 rounded-xl p-5 border border-gray-700/40">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 text-[10px] bg-green-900/50 text-green-400 rounded font-medium">${ep.method}</span>
              <code class="text-sm text-blue-400 font-mono">${ep.path}</code>
              <span class="text-[10px] text-gray-500 ml-auto">${ep.credits} credit${ep.credits !== '1' ? 's' : ''}</span>
            </div>
            <p class="text-xs text-gray-400">${ep.desc}</p>
            ${ep.params ? `<div class="text-[11px] text-gray-500 mt-2"><strong class="text-gray-400">Params:</strong> ${ep.params}</div>` : ''}
          </div>
        `).join('')}

        <div class="bg-gray-800/40 rounded-xl p-5 border border-gray-700/40 space-y-3">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Response shapes</div>
          ${codeBlock('json', '// GET /api/v2/indicators/{id}/latest\n{\n  "id": "abc123",\n  "name": "Crypto Sentiment",\n  "score": 67.4,\n  "label": "Bullish",\n  "predictive": {\n    "score": 72,\n    "peakCorrelation": 0.54,\n    "optimalLag": 3\n  },\n  "credits_remaining": 99\n}')}
          <div class="mt-3">
          ${codeBlock('json', '// GET /api/v2/indicators/{id}/timeseries\n{\n  "id": "abc123",\n  "timeseries": {\n    "dates": ["2026-01-01", ...],\n    "scores": [52.3, ...],\n    "prices": [94521, ...],\n    "fgValues": [45, ...],\n    "points": 365\n  },\n  "predictive": { "score": 72, "peakCorrelation": 0.54, "optimalLag": 3 },\n  "credits_remaining": 98\n}')}
          </div>
        </div>

        <div class="bg-gray-800/40 rounded-xl p-5 border border-gray-700/40 space-y-3">
          <div class="text-xs text-gray-500 uppercase tracking-wide">Examples</div>
          ${codeBlock('python', 'import requests\n\nheaders = {"X-API-Key": "pmsi_your_key"}\n\n# Latest score\nr = requests.get(\n    "https://pmsi.app/api/v2/indicators/abc123/latest",\n    headers=headers\n)\ndata = r.json()\nprint(f"Score: {data[\'score\']} ({data[\'label\']})")\nprint(f"Predictive: {data[\'predictive\'][\'score\']}, lag: {data[\'predictive\'][\'optimalLag\']}d")')}
          <div class="mt-3">
          ${codeBlock('javascript', 'const res = await fetch(\n  "https://pmsi.app/api/v2/indicators/abc123/timeseries?start=2026-01-01",\n  { headers: { "X-API-Key": "pmsi_your_key" } }\n);\nconst { timeseries, predictive } = await res.json();\nconsole.log(`${timeseries.points} data points, predictive: ${predictive.score}`);')}
          </div>
        </div>
      </div>
    </section>`;

  // Pricing
  content += `
    <section id="doc-pricing" class="scroll-mt-20 mb-12">
      <h2 class="text-xl font-medium text-gray-100 mb-4">Pricing</h2>
      <div class="bg-gray-800/40 rounded-xl p-6 border border-gray-700/40 space-y-5">
        <p class="text-sm text-gray-300">API credits are purchased in SOL bundles tied to specific indicators. Creators set pricing for 4 tiers.</p>
        <div class="grid grid-cols-4 gap-3">
          ${[10, 50, 100, 500].map(t => `
            <div class="bg-gray-900/50 rounded-lg p-4 text-center border border-gray-700/30">
              <div class="text-2xl font-semibold text-gray-100">${t}</div>
              <div class="text-[11px] text-gray-500 mt-1">API calls</div>
            </div>
          `).join('')}
        </div>
        <div class="space-y-2 text-xs text-gray-400 leading-relaxed">
          <p><strong class="text-gray-300">Creator-set pricing</strong> \u2014 Each indicator owner configures SOL prices per tier in the Builder.</p>
          <p><strong class="text-gray-300">50/50 revenue split</strong> \u2014 Half to the indicator creator, half to the platform.</p>
          <p><strong class="text-gray-300">Purchase flow</strong> \u2014 Select a bundle \u2192 pay via Phantom wallet \u2192 credits added to your API key instantly.</p>
          <p><strong class="text-gray-300">Free indicators</strong> \u2014 Creators can leave pricing empty for free API access.</p>
        </div>
      </div>
    </section>`;

  el.innerHTML = `
    <div class="flex gap-10">
      ${sidebar}
      <div class="flex-1 min-w-0">
        <h1 class="text-2xl font-light text-gray-100 mb-8">Documentation</h1>
        ${content}
      </div>
    </div>`;

  // Scroll-spy for sidebar highlighting
  initDocsScrollSpy(sections);
}

function initDocsScrollSpy(sections) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const id = entry.target.id.replace('doc-', '');
        document.querySelectorAll('#docs-nav a').forEach(a => {
          const isActive = a.dataset.docNav === id;
          a.classList.toggle('text-gray-200', isActive);
          a.classList.toggle('bg-gray-800/60', isActive);
          a.classList.toggle('text-gray-500', !isActive);
        });
      }
    }
  }, { rootMargin: '-20% 0px -70% 0px' });

  sections.forEach(s => {
    const el = document.getElementById('doc-' + s.id);
    if (el) observer.observe(el);
  });
}
