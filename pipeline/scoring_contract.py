"""Versioned scoring contract shared by pipeline exports and status surfaces."""

from __future__ import annotations

SCORING_VERSION = "4.0.0"
EXPORT_SCHEMA_VERSION = 2

SCORING_CONTRACT = {
    "version": SCORING_VERSION,
    "signal": {
        "formula": "tanh(K * (probability - 0.5)), K=3.0; inverted for bearish polarity",
        "description": "YES probabilities map to directional sentiment in [-1, 1]. Neutral polarity contributes weight with signal 0.",
    },
    "weight": {
        "formula": "0.4*log(volume) + 0.3*log(liquidity) + 0.2*log(open_interest) + 0.1*time_decay",
        "description": "More liquid, actively traded, longer-horizon markets receive more confidence weight.",
    },
    "universe": {
        "formula": "sector_tag_match OR sector_search/tag_provenance OR (untagged AND question_pattern_match); excluded tags always lose",
        "description": "Sector membership is a positive decision. The bulk volume feed is a candidate pool, not the universe — before 4.0.0 every sector scored the same ~1,750-market set, so an S&P indicator could be led by an Iranian regime-change market.",
    },
    "classification": {
        "formula": "word-boundary regex per sector rule set; longest matching keyword wins; ties across signal types are ambiguous -> unclassified",
        "description": "Rules are scoped per sector and matched on word boundaries. Before 4.0.0 an unbounded substring match on a global list made 'g(over)nment shutdown' a bullish price target and left the inflation/unemployment rules unreachable behind 'above'.",
    },
    "composite": {
        "formula": "event_weighted_average over DIRECTIONAL markets only (excludes unclassified and price_range), weighted by max_market_weight_per_event",
        "description": "Markets are grouped by event_id; each event contributes one consolidated signal weighted by its strongest market. Unclassified markets are excluded rather than averaged in at signal 0 — carrying them in the denominator pinned every sector near 50.",
    },
    "coverage": {
        "formula": "classified_pct = scored_market_count / market_count; coverage_ok = scored >= 25 AND classified_pct >= 20",
        "description": "Coverage ships with the score. A composite over 0.4% of observed markets is not a sector reading, and is flagged rather than presented as measured.",
    },
    "indicator": {
        "formula": "weighted_average(market_or_category_signal, user_weight * market_weight), normalized to 0-100",
        "description": "Builder and API indicators apply user weights on top of base market weights, then optionally blend Fear & Greed.",
    },
    "predictive": {
        "formula": "signed IC = corr(score_t - score_{t-1}, price_{t+7}/price_t - 1); t-stat on n_eff = n/lag; significant at |t| >= 2",
        "description": "Signed information coefficient at a fixed 7-period lag, on score CHANGES (levels are autocorrelated, which overstates r) with the sample deflated for overlapping windows. Negative values are reported as negative. Before 4.0.0 the score took the max over 8 lags and clamped negatives to zero, so noise scored positive and the metric could never report failure; the best lag is still shown, labelled in-sample.",
    },
    "backtest": {
        "description": "Backtest summary metrics use completed round-trip trades; final open positions are mark-to-market in equity and shown separately in the trade log.",
    },
}


def scoring_metadata() -> dict:
    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "scoring_version": SCORING_VERSION,
        "scoring_contract": SCORING_CONTRACT,
    }
