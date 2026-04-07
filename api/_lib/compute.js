const { getDb } = require('./db');

const SECTOR_CATEGORIES = {
  crypto: ['price_targets', 'regulatory', 'adoption', 'events'],
  politics: ['favors_incumbent', 'favors_challenger', 'legislative', 'judicial', 'geopolitical'],
  stocks: ['price_targets', 'earnings', 'corporate'],
  economy: ['monetary_policy', 'inflation', 'growth', 'employment'],
};

/**
 * Compute indicator timeseries server-side from market_snapshots table.
 * Supports both market-mode (indicator.markets) and legacy category-mode (indicator.weights).
 * Returns { dates, scores, prices, fgValues, latestScore, config }.
 */
async function computeIndicator(indicator) {
  const sql = getDb();
  const asset = indicator.asset || 'BTC';
  const fgEnabled = indicator.fg_enabled ?? indicator.fgEnabled ?? false;
  const fgWeight = (indicator.fg_weight ?? indicator.fgWeight ?? 30) / 100;

  // Detect mode: market-mode if indicator has markets field
  const markets = indicator.markets || (indicator.weights?.markets) || null;
  const isMarketMode = !!markets && typeof markets === 'object' && !Array.isArray(markets)
    && Object.keys(markets).length > 0;

  let dateMap, allDates;

  if (isMarketMode) {
    // Per-market query
    const marketIds = Object.keys(markets);
    const rows = await sql`
      SELECT date, market_id, sentiment_signal, weight
      FROM market_snapshots
      WHERE asset = ${asset} AND market_id = ANY(${marketIds})
      ORDER BY date
    `;

    dateMap = {};
    allDates = new Set();
    for (const r of rows) {
      allDates.add(r.date);
      if (!dateMap[r.date]) dateMap[r.date] = {};
      dateMap[r.date][r.market_id] = {
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
      WHERE asset = ${asset}
      GROUP BY date, cat
      ORDER BY date
    `;

    dateMap = {};
    allDates = new Set();
    for (const r of rows) {
      allDates.add(r.date);
      if (!dateMap[r.date]) dateMap[r.date] = {};
      dateMap[r.date][r.cat] = { ws: parseFloat(r.ws), wt: parseFloat(r.wt) };
    }
  }

  // Fetch reference prices
  const refs = await sql`
    SELECT date, btc_price, fear_greed
    FROM reference_prices
    ORDER BY date
  `;
  const refMap = {};
  for (const r of refs) {
    refMap[r.date] = { btc_price: r.btc_price, fear_greed: r.fear_greed };
  }

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
        num += w * m.ss * m.wt;
        den += w * m.wt;
      }

      let score = den > 0 ? ((num / den) + 1) * 50 : null;
      const ref = refMap[d];
      const fg = ref?.fear_greed != null ? parseFloat(ref.fear_greed) : null;

      if (score != null && fgEnabled && fg != null) {
        score = score * (1 - fgWeight) + fg * fgWeight;
      }

      scores.push(score != null ? Math.round(score * 10) / 10 : null);
      prices.push(ref?.btc_price != null ? parseFloat(ref.btc_price) : null);
      fgValues.push(fg);
    }
  } else {
    const weights = indicator.weights || {};
    const includeOther = indicator.include_other ?? indicator.includeOther ?? false;
    const sectorId = indicator.sector || 'crypto';
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
      prices.push(ref?.btc_price != null ? parseFloat(ref.btc_price) : null);
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

  const latestScore = [...scores].reverse().find(s => s != null);

  return {
    dates,
    scores,
    prices,
    fgValues,
    latestScore,
    breakdown,
    config: {
      name: indicator.name,
      asset,
      ...(isMarketMode
        ? { markets, marketCount: Object.keys(markets).length }
        : { weights: indicator.weights || {}, includeOther: indicator.include_other ?? indicator.includeOther ?? false }),
      fgEnabled,
      fgWeight: fgWeight * 100,
    },
  };
}

module.exports = { computeIndicator };
