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
    `${source}\nglobalThis.__sandboxExports = { computePredictiveScore, computeBacktest, computeBuilderTimeseries, computeIndicatorTimeseries, builderState };`,
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

test('predictive score uses forward returns and does not reward inverse correlation', () => {
  const scores = Array.from({ length: 40 }, (_, i) => 90 - i);
  const returns = scores.slice(0, -1).map(score => -(score - 70) / 1000);
  const prices = pricesFromReturns(returns);

  const apiResult = computePredictiveScore(scores, prices);
  const browserResult = sandbox.computePredictiveScore(scores, prices);

  assert.equal(apiResult.score, 0);
  assert.ok(apiResult.peakCorrelation < 0);
  assert.equal(browserResult.score, apiResult.score);
  assert.equal(browserResult.peakCorrelation, apiResult.peakCorrelation);
  assert.equal(browserResult.optimalLag, apiResult.optimalLag);
});

test('predictive score rewards positive signed correlation to future returns', () => {
  const scores = Array.from({ length: 40 }, (_, i) => 50 + i);
  const returns = scores.slice(0, -1).map(score => (score - 70) / 1000);
  const prices = pricesFromReturns(returns);

  const result = computePredictiveScore(scores, prices);

  assert.ok(result.score > 60);
  assert.ok(result.peakCorrelation > 0);
  assert.equal(result.optimalLag, 1);
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
