import test from 'node:test';
import assert from 'node:assert/strict';
import privacy from '../api/_lib/indicatorPrivacy.js';

const {
  hasPaidPricing,
  marketCountFromRow,
  paidApiConfigSummary,
  publicIndicatorPayload,
} = privacy;

test('paid public indicator payload redacts recipe by default', () => {
  const row = {
    id: 'paid-1',
    name: 'Paid Alpha',
    sector: 'crypto',
    asset: 'BTC',
    weights: {
      referenceAsset: 'btc_price',
      markets: {
        m1: { w: 70, flip: false },
        m2: { w: 30, flip: true },
      },
    },
    price_bundle_10: '0.5',
  };

  const payload = publicIndicatorPayload(row);

  assert.equal(payload.protected, true);
  assert.equal(payload.forkable, false);
  assert.equal(payload.marketCount, 2);
  assert.equal(payload.minPrice, 0.5);
  assert.equal(Object.hasOwn(payload, 'markets'), false);
  assert.equal(Object.hasOwn(payload, 'weights'), false);
  assert.equal(Object.hasOwn(payload, 'referenceAsset'), false);
});

test('free public indicator payload can expose recipe for browser computation', () => {
  const row = {
    id: 'free-1',
    name: 'Free Signal',
    sector: 'stocks',
    asset: 'SPX',
    weights: { referenceAsset: 'spx_price', earnings: 80, corporate: 20 },
  };

  const payload = publicIndicatorPayload(row, { includeConfig: true });

  assert.equal(hasPaidPricing(row), false);
  assert.equal(payload.protected, false);
  assert.equal(payload.forkable, true);
  assert.equal(payload.referenceAsset, 'spx_price');
  assert.deepEqual(payload.weights, row.weights);
  assert.equal(marketCountFromRow(row), 2);
});

test('paid API config summary omits full weights and markets', () => {
  const indicator = {
    sector: 'politics',
    asset: 'GOV',
    weights: { referenceAsset: null, markets: { election: { w: 100, flip: false } } },
  };
  const summary = paidApiConfigSummary(indicator, {
    config: {
      asset: 'GOV',
      referenceAsset: null,
      marketCount: 1,
      fgEnabled: true,
      fgWeight: 15,
    },
  });

  assert.equal(summary.protected, true);
  assert.equal(summary.marketCount, 1);
  assert.equal(Object.hasOwn(summary, 'markets'), false);
  assert.equal(Object.hasOwn(summary, 'weights'), false);
});
