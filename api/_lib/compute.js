const { getDb } = require('./db');

const SECTOR_CATEGORIES = {
  crypto: ['price_targets', 'regulatory', 'adoption', 'events'],
  politics: ['favors_incumbent', 'favors_challenger', 'legislative', 'judicial', 'geopolitical'],
  stocks: ['price_targets', 'earnings', 'corporate'],
  economy: ['monetary_policy', 'inflation', 'growth', 'employment'],
};

const SECTOR_DEFAULT_REFERENCE_ASSET = {
  crypto: 'btc_price',
  stocks: 'spx_price',
  economy: 'us10y_yield',
  politics: null,
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function resolveReferenceAsset(indicator, weightsConfig = {}) {
  const sectorId = indicator?.sector || 'crypto';
  if (hasOwn(indicator, 'referenceAsset')) return indicator.referenceAsset;
  if (hasOwn(indicator, 'reference_asset')) return indicator.reference_asset;
  if (hasOwn(weightsConfig, 'referenceAsset')) return weightsConfig.referenceAsset;
  if (hasOwn(weightsConfig, 'reference_asset')) return weightsConfig.reference_asset;
  if (hasOwn(SECTOR_DEFAULT_REFERENCE_ASSET, sectorId)) return SECTOR_DEFAULT_REFERENCE_ASSET[sectorId];
  return 'btc_price';
}

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Compute indicator timeseries server-side from market_snapshots table.
 * Supports both market-mode (indicator.markets) and legacy category-mode (indicator.weights).
 * Returns { dates, scores, prices, fgValues, latestScore, config }.
 */
async function computeIndicator(indicator) {
  const sql = getDb();
  const asset = indicator.asset || 'BTC';
  const weightsConfig = indicator.weights || {};
  const sectorId = indicator.sector || 'crypto';
  const referenceAsset = resolveReferenceAsset(indicator, weightsConfig);
  const fgEnabled = indicator.fg_enabled ?? indicator.fgEnabled ?? false;
  const fgWeight = (indicator.fg_weight ?? indicator.fgWeight ?? 30) / 100;

  // Detect mode: market-mode if indicator has markets field
  const rawMarkets = indicator.markets || weightsConfig.markets || null;
  const isMarketMode = !!rawMarkets && typeof rawMarkets === 'object' && !Array.isArray(rawMarkets)
    && Object.keys(rawMarkets).length > 0;

  // Normalize market config: support { mid: number }, { mid: { weight, sector } }, { mid: { w, flip } }
  let markets = null;
  let marketFlips = {};
  let marketSectors = {};
  if (isMarketMode) {
    markets = {};
    for (const [mid, val] of Object.entries(rawMarkets)) {
      if (typeof val === 'number') {
        markets[mid] = val;
        marketSectors[mid] = sectorId;
      } else {
        markets[mid] = val?.w ?? val?.weight ?? 100;
        if (val?.flip) marketFlips[mid] = true;
        marketSectors[mid] = val?.sector || sectorId;
      }
    }
  }

  let dateMap, allDates;

  if (isMarketMode) {
    // Per-market query. Market IDs are not globally unique across our sector
    // snapshots, so scope every saved selection to its explicit sector or to
    // the indicator sector by default.
    const marketIds = Object.keys(markets);
    const sectors = [...new Set(Object.values(marketSectors).filter(Boolean))];
    const rows = await sql`
      SELECT date, market_id, sector, sentiment_signal, weight
      FROM market_snapshots
      WHERE market_id = ANY(${marketIds}) AND sector = ANY(${sectors})
      ORDER BY date
    `;

    dateMap = {};
    allDates = new Set();
    for (const r of rows) {
      if (r.sector !== marketSectors[r.market_id]) continue;
      const d = dateKey(r.date);
      allDates.add(d);
      if (!dateMap[d]) dateMap[d] = {};
      dateMap[d][r.market_id] = {
        ss: parseFloat(r.sentiment_signal),
        wt: parseFloat(r.weight),
      };
    }
  } else {
    // Legacy category-mode query — covers all sector signal types
    const rows = await sql`
      SELECT date,
        CASE
          WHEN classification IN ('price_above','price_below','price_range') THEN 'price_targets'
          WHEN classification IN ('regulatory_positive','regulatory_negative') THEN 'regulatory'
          WHEN classification = 'adoption' THEN 'adoption'
          WHEN classification IN ('event_positive','event_negative') THEN 'events'
          WHEN classification = 'favors_incumbent' THEN 'favors_incumbent'
          WHEN classification = 'favors_challenger' THEN 'favors_challenger'
          WHEN classification IN ('legislative_positive','legislative_negative') THEN 'legislative'
          WHEN classification = 'judicial_event' THEN 'judicial'
          WHEN classification = 'geopolitical_event' THEN 'geopolitical'
          WHEN classification IN ('earnings_positive','earnings_negative') THEN 'earnings'
          WHEN classification IN ('corporate_positive','corporate_negative') THEN 'corporate'
          WHEN classification IN ('monetary_dovish','monetary_hawkish') THEN 'monetary_policy'
          WHEN classification IN ('inflation_rising','inflation_falling') THEN 'inflation'
          WHEN classification IN ('growth_positive','growth_negative') THEN 'growth'
          WHEN classification IN ('employment_positive','employment_negative') THEN 'employment'
          ELSE 'other'
        END as cat,
        SUM(sentiment_signal * weight) as ws,
        SUM(weight) as wt,
        COUNT(*) as n
      FROM market_snapshots
      WHERE sector = ${sectorId} AND asset = ${asset}
      GROUP BY date, cat
      ORDER BY date
    `;

    dateMap = {};
    allDates = new Set();
    for (const r of rows) {
      const d = dateKey(r.date);
      allDates.add(d);
      if (!dateMap[d]) dateMap[d] = {};
      dateMap[d][r.cat] = { ws: parseFloat(r.ws), wt: parseFloat(r.wt) };
    }
  }

  // Fetch reference prices (all columns for cross-sector support)
  const refs = await sql`
    SELECT date, btc_price, fear_greed, eth_price, sol_price,
      spx_price, ndx_price, dji_price, rut_price, vix_price,
      us10y_yield, us2y_yield, dxy_price, fed_rate, unemployment,
      gold_price, oil_price
    FROM reference_prices
    ORDER BY date
  `;
  const refMap = {};
  for (const r of refs) {
    refMap[dateKey(r.date)] = r;
  }

  const scoringSectors = isMarketMode
    ? [...new Set(Object.values(marketSectors).filter(Boolean))]
    : [sectorId];
  const latestSnapshotRows = await sql`
    SELECT MAX(date) AS date
    FROM market_snapshots
    WHERE sector = ANY(${scoringSectors})
  `;
  const currentSnapshotDate = latestSnapshotRows?.[0]?.date ? dateKey(latestSnapshotRows[0].date) : null;

  // Determine which reference key to use for price overlay
  const refPriceKey = referenceAsset;

  const dates = [...allDates].sort();
  const scores = [];
  const prices = [];
  const fgValues = [];
  const breakdown = {};

  if (isMarketMode) {
    for (const d of dates) {
      const mktData = dateMap[d] || {};
      let num = 0, den = 0;

      for (const [mid, userWeight] of Object.entries(markets)) {
        const m = mktData[mid];
        if (!m) continue;
        const w = userWeight / 100;
        const sign = marketFlips[mid] ? -1 : 1;
        num += w * sign * m.ss * m.wt;
        den += w * m.wt;
      }

      let score = den > 0 ? ((num / den) + 1) * 50 : null;
      const ref = refMap[d];
      const fg = ref?.fear_greed != null ? parseFloat(ref.fear_greed) : null;

      if (score != null && fgEnabled && fg != null) {
        score = score * (1 - fgWeight) + fg * fgWeight;
      }

      scores.push(score != null ? Math.round(score * 10) / 10 : null);
      prices.push(ref?.[refPriceKey] != null ? parseFloat(ref[refPriceKey]) : null);
      fgValues.push(fg);
    }
  } else {
    const weights = weightsConfig || {};
    const includeOther = indicator.include_other ?? indicator.includeOther ?? false;
    const catKeys = [...(SECTOR_CATEGORIES[sectorId] || SECTOR_CATEGORIES.crypto)];
    if (includeOther) catKeys.push('other');

    for (const d of dates) {
      const cats = dateMap[d] || {};
      let num = 0, den = 0;

      for (const cat of catKeys) {
        const w = (weights[cat] || 0) / 100;
        const cd = cats[cat];
        if (!cd || w === 0) continue;
        num += w * cd.ws;
        den += w * cd.wt;
      }

      let score = den > 0 ? ((num / den) + 1) * 50 : null;
      const ref = refMap[d];
      const fg = ref?.fear_greed != null ? parseFloat(ref.fear_greed) : null;

      if (score != null && fgEnabled && fg != null) {
        score = score * (1 - fgWeight) + fg * fgWeight;
      }

      scores.push(score != null ? Math.round(score * 10) / 10 : null);
      prices.push(ref?.[refPriceKey] != null ? parseFloat(ref[refPriceKey]) : null);
      fgValues.push(fg);

      // Category breakdown for latest date
      if (d === dates[dates.length - 1]) {
        for (const cat of catKeys) {
          const cd = cats[cat];
          if (cd && cd.wt > 0) {
            breakdown[cat] = Math.round(((cd.ws / cd.wt) + 1) * 500) / 10;
          }
        }
      }
    }
  }

  const latestDate = dates[dates.length - 1] || null;
  const latestScore = latestDate && latestDate === currentSnapshotDate ? scores[scores.length - 1] : null;
  const predictive = computePredictiveScore(scores, prices);

  return {
    dates,
    scores,
    prices,
    fgValues,
    latestScore,
    predictive,
    breakdown,
    config: {
      name: indicator.name,
      asset,
      sector: sectorId,
      referenceAsset,
      ...(isMarketMode
        ? { markets, marketCount: Object.keys(markets).length }
        : { weights: indicator.weights || {}, includeOther: indicator.include_other ?? indicator.includeOther ?? false }),
      fgEnabled,
      fgWeight: fgWeight * 100,
    },
  };
}

/**
 * Compute Predictive Score: how well indicator scores lead future reference returns.
 * Cross-correlates against forward returns at multiple lags and only rewards
 * positive signed correlation, returning { score, peakCorrelation, optimalLag }.
 */
function computePredictiveScore(scores, prices) {
  const lags = [1, 2, 3, 5, 7, 14, 21, 30];
  let bestPositive = null;
  let strongestInverse = null;

  for (const lag of lags) {
    const pairs = [];
    for (let i = 0; i < scores.length - lag; i++) {
      if (scores[i] != null && prices[i] != null && prices[i + lag] != null && prices[i] > 0) {
        pairs.push([scores[i], prices[i + lag] / prices[i] - 1]);
      }
    }
    if (pairs.length < 10) continue;

    const n = pairs.length;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
    const my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (const [x, y] of pairs) {
      const dx = x - mx, dy = y - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const den = Math.sqrt(dx2 * dy2);
    const r = den > 0 ? num / den : 0;

    if (r > 0 && (!bestPositive || r > bestPositive.r)) {
      bestPositive = { r, lag };
    }
    if (r < 0 && (!strongestInverse || Math.abs(r) > Math.abs(strongestInverse.r))) {
      strongestInverse = { r, lag };
    }
  }

  const selected = bestPositive || strongestInverse;
  if (!selected) return null;

  const positiveR = Math.max(0, selected.r);
  const lagMultiplier = 0.7 + (1 - selected.lag / 30) * 0.3;
  const score = Math.round(positiveR * 100 * lagMultiplier);
  return {
    score: Math.max(0, Math.min(100, score)),
    peakCorrelation: Math.round(selected.r * 1000) / 1000,
    optimalLag: selected.lag,
  };
}

module.exports = { computeIndicator, computePredictiveScore, resolveReferenceAsset };
