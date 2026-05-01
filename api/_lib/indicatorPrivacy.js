const BUNDLE_TIERS = [10, 50, 100, 500];

function parsePrice(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bundlePricesFromRow(row = {}) {
  return BUNDLE_TIERS.reduce((prices, tier) => {
    prices[tier] = parsePrice(row[`price_bundle_${tier}`]);
    return prices;
  }, {});
}

function hasPaidPricing(rowOrPrices = {}) {
  const prices = Object.prototype.hasOwnProperty.call(rowOrPrices, 'price_bundle_10')
    ? bundlePricesFromRow(rowOrPrices)
    : rowOrPrices;
  return BUNDLE_TIERS.some(tier => parsePrice(prices[tier]) != null);
}

function minBundlePrice(rowOrPrices = {}) {
  const prices = Object.prototype.hasOwnProperty.call(rowOrPrices, 'price_bundle_10')
    ? bundlePricesFromRow(rowOrPrices)
    : rowOrPrices;
  const values = BUNDLE_TIERS.map(tier => parsePrice(prices[tier])).filter(v => v != null);
  return values.length ? Math.min(...values) : null;
}

function configFromRow(row = {}) {
  const weights = row.weights || {};
  const markets = weights.markets || row.markets || null;
  return {
    weights,
    markets,
    referenceAsset: weights.referenceAsset ?? null,
  };
}

function marketCountFromRow(row = {}) {
  const { markets, weights } = configFromRow(row);
  if (markets && typeof markets === 'object' && !Array.isArray(markets)) {
    return Object.keys(markets).length;
  }
  return Object.entries(weights || {})
    .filter(([key, value]) => !['referenceAsset', 'markets'].includes(key) && Number(value) > 0)
    .length;
}

function publicIndicatorPayload(row, options = {}) {
  const includeConfig = options.includeConfig === true;
  const prices = bundlePricesFromRow(row);
  const paid = hasPaidPricing(prices);
  const { weights, markets, referenceAsset } = configFromRow(row);
  const payload = {
    id: row.id,
    name: row.name,
    sector: row.sector || 'crypto',
    asset: row.asset || 'BTC',
    protected: paid,
    isPaid: paid,
    forkable: !paid,
    marketCount: marketCountFromRow(row),
    bundlePrices: prices,
    minPrice: minBundlePrice(prices),
  };

  if (includeConfig) {
    if (markets && typeof markets === 'object' && Object.keys(markets).length > 0) {
      payload.markets = markets;
    } else {
      payload.weights = weights;
    }
    payload.referenceAsset = referenceAsset;
  }

  return payload;
}

function paidApiConfigSummary(indicator, result = {}) {
  const config = result.config || {};
  return {
    protected: true,
    sector: indicator.sector || config.sector || 'crypto',
    asset: config.asset || indicator.asset || 'BTC',
    referenceAsset: config.referenceAsset ?? null,
    marketCount: config.marketCount ?? marketCountFromRow(indicator),
    fgEnabled: !!config.fgEnabled,
    fgWeight: config.fgWeight ?? indicator.fg_weight ?? null,
  };
}

module.exports = {
  BUNDLE_TIERS,
  bundlePricesFromRow,
  hasPaidPricing,
  minBundlePrice,
  configFromRow,
  marketCountFromRow,
  publicIndicatorPayload,
  paidApiConfigSummary,
};
