import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computePredictiveScore, resolveReferenceAsset } = require('../api/_lib/compute.js');

function loadSandbox() {
  const source = readFileSync(new URL('../public/js/sandbox.js', import.meta.url), 'utf8');
  const context = {
    console,
    SECTOR_ORDER: ['crypto', 'politics'],
    SECTORS: {
      crypto: {
        referenceData: { priceKey: 'btc_price' },
        categories: { price_targets: {}, regulatory: {}, adoption: {}, events: {}, other: {} },
      },
      politics: {
        referenceData: { priceKey: null },
        categories: { favors_incumbent: {}, favors_challenger: {}, legislative: {}, judicial: {}, geopolitical: {}, other: {} },
      },
    },
    sectorDataCache: {},
    ALL_REFERENCE_ASSETS: [{ key: 'btc_price', sector: 'crypto', label: 'Bitcoin' }],
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nglobalThis.__sandboxExports = { computePredictiveScore, computeBacktest, computeBuilderTimeseries, computeIndicatorTimeseries, invalidateMarketHistoryIndex, builderState };`,
    context
  );
  return { exports: context.__sandboxExports, context };
}

const { exports: sandbox, context: sandboxContext } = loadSandbox();

function pricesFromReturns(returns) {
  const prices = [100];
  for (const ret of returns) {
    prices.push(prices[prices.length - 1] * (1 + ret));
  }
  return prices;
}

// Deterministic pseudo-random deltas. A linear score ramp is degenerate under
// differencing (constant delta => zero variance => undefined correlation), so
// fixtures need genuinely varying score changes.
function seededDeltas(n, seed = 17) {
  const out = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push((x / 2147483648) - 0.5);
  }
  return out;
}

// Builds a price path where the forward `lag`-period return is driven by the
// score change `lag` steps earlier, with `sign` setting the direction.
function seriesWithLeadRelationship(n, lag, sign) {
  const deltas = seededDeltas(n);
  const scores = [50];
  for (let i = 1; i < n; i++) scores.push(scores[i - 1] + deltas[i] * 5);
  const prices = new Array(n);
  for (let i = 0; i < lag; i++) prices[i] = 100;
  for (let i = lag; i < n; i++) {
    const ds = scores[i - lag] - scores[i - lag - 1] || 0;
    prices[i] = prices[i - lag] * (1 + sign * 0.02 * ds);
  }
  return { scores, prices };
}

test('predictive score reports inverse correlation as negative rather than clamping it to zero', () => {
  const { scores, prices } = seriesWithLeadRelationship(160, 7, -1);

  const apiResult = computePredictiveScore(scores, prices);
  const browserResult = sandbox.computePredictiveScore(scores, prices);

  // The old implementation did Math.max(0, r), so a perfectly inverted
  // indicator scored 0 — indistinguishable from one with no signal at all.
  assert.ok(apiResult.score < 0, `expected negative score, got ${apiResult.score}`);
  assert.ok(apiResult.ic < 0);
  assert.equal(apiResult.significant, true);
  assert.equal(browserResult.score, apiResult.score);
  assert.equal(browserResult.ic, apiResult.ic);
  assert.equal(browserResult.lag, apiResult.lag);
});

test('predictive score reports a genuine positive lead relationship', () => {
  const { scores, prices } = seriesWithLeadRelationship(160, 7, 1);

  const result = computePredictiveScore(scores, prices);

  assert.ok(result.ic > 0.5, `expected strong positive ic, got ${result.ic}`);
  assert.equal(result.significant, true);
  assert.equal(result.lag, 7);
  assert.equal(result.score, Math.round(result.ic * 100));
});

test('predictive score does not manufacture signal from noise', () => {
  // Independent score and price series: the honest answer is "no measurable
  // power". The old max-over-8-lags-then-clamp made this strictly positive.
  const deltas = seededDeltas(300, 5);
  const other = seededDeltas(300, 99);
  const scores = [50];
  for (let i = 1; i < 300; i++) scores.push(scores[i - 1] + deltas[i] * 5);
  const prices = [100];
  for (let i = 1; i < 300; i++) prices.push(prices[i - 1] * (1 + other[i] * 0.02));

  const result = computePredictiveScore(scores, prices);

  assert.equal(result.significant, false);
  assert.ok(Math.abs(result.ic) < 0.2, `expected near-zero ic, got ${result.ic}`);
});

test('predictive score labels its best lag as in-sample', () => {
  const { scores, prices } = seriesWithLeadRelationship(160, 7, 1);
  const result = computePredictiveScore(scores, prices);

  // Picking the max over 8 lags is data mining; the headline must not be it.
  assert.equal(result.inSampleBest.inSample, true);
  assert.equal(result.lag, 7);
  assert.ok(Array.isArray(result.byLag) && result.byLag.length > 1);
  assert.ok(result.byLag.every(l => typeof l.tStat === 'number' && l.nEff <= l.n));
});

test('reference asset resolver preserves explicit and sector-level nulls', () => {
  assert.equal(resolveReferenceAsset({ sector: 'politics', referenceAsset: null }, {}), null);
  assert.equal(resolveReferenceAsset({ sector: 'politics' }, {}), null);
  assert.equal(resolveReferenceAsset({ sector: 'crypto' }, {}), 'btc_price');
});

test('backtest counts only completed round trips in summary metrics', () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const scores = Array(12).fill(70);
  const prices = Array.from({ length: 12 }, (_, i) => 100 + i);

  const result = sandbox.computeBacktest(dates, scores, prices, 60, 40, 'momentum');

  assert.equal(result.trades, 0);
  assert.equal(result.winRate, 0);
  assert.equal(result.avgTrade, 0);
  assert.equal(result.tradeLog.length, 1);
  assert.equal(result.tradeLog[0].open, true);
  assert.ok(result.totalReturn > 0);
});

test('builder category scores apply selected market user weights', () => {
  const date = '2026-01-01';
  sandboxContext.sectorDataCache.crypto = {
    refMap: { [date]: { btc_price: 100 } },
    sandbox: {
      assets: {
        BTC: {
          dates: [date],
          cats: {},
          markets: {
            m1: { cat: 'price_targets', ss: [1], wt: [1], q: 'bullish market' },
            m2: { cat: 'price_targets', ss: [-1], wt: [1], q: 'ignored market' },
          },
        },
      },
    },
  };
  sandbox.builderState.selectedMarkets = {
    m1: { w: 100, flip: false },
    m2: { w: 0, flip: false },
  };
  sandbox.builderState.referenceAsset = 'btc_price';
  sandbox.builderState.fgEnabled = false;

  const result = sandbox.computeBuilderTimeseries();

  assert.equal(result.dates.length, 1);
  assert.equal(result.dates[0], date);
  assert.equal(result.scores[0], 100);
  assert.equal(result.catScores.price_targets[0], 100);
});

test('browser indicator series keeps politics default reference asset empty', () => {
  const date = '2026-01-02';
  sandboxContext.sectorDataCache.politics = {
    refMap: { [date]: { btc_price: 123 } },
    sandbox: {
      assets: {
        GOV: {
          dates: [date],
          cats: {
            favors_incumbent: { ws: [1], wt: [1] },
            favors_challenger: { ws: [0], wt: [0] },
            legislative: { ws: [0], wt: [0] },
            judicial: { ws: [0], wt: [0] },
            geopolitical: { ws: [0], wt: [0] },
          },
          markets: {},
        },
      },
    },
  };

  const result = sandbox.computeIndicatorTimeseries(
    {
      sector: 'politics',
      asset: 'GOV',
      weights: { favors_incumbent: 100 },
      fgEnabled: false,
    },
    sandboxContext.sectorDataCache.politics
  );

  assert.equal(result.scores[0], 100);
  assert.equal(result.prices[0], null);
});

test('browser market-mode series scopes duplicate market ids to indicator sector', () => {
  const date = '2026-01-03';
  sandboxContext.sectorDataCache.crypto = {
    refMap: { [date]: { btc_price: 100 } },
    sandbox: {
      assets: {
        BTC: {
          dates: [date],
          cats: {},
          markets: {
            dup: { cat: 'price_targets', ss: [1], wt: [1], q: 'crypto duplicate' },
          },
        },
      },
    },
  };
  sandboxContext.sectorDataCache.politics = {
    refMap: { [date]: {} },
    sandbox: {
      assets: {
        GOV: {
          dates: [date],
          cats: {},
          markets: {
            dup: { cat: 'other', ss: [-1], wt: [1], q: 'politics duplicate' },
          },
        },
      },
    },
  };
  sandbox.invalidateMarketHistoryIndex();

  const cryptoResult = sandbox.computeIndicatorTimeseries(
    { sector: 'crypto', asset: 'BTC', markets: { dup: { w: 100 } }, fgEnabled: false },
    sandboxContext.sectorDataCache.crypto
  );
  const politicsResult = sandbox.computeIndicatorTimeseries(
    { sector: 'politics', asset: 'GOV', markets: { dup: { w: 100 } }, fgEnabled: false },
    sandboxContext.sectorDataCache.politics
  );

  assert.equal(cryptoResult.scores[0], 100);
  assert.equal(politicsResult.scores[0], 0);
});
