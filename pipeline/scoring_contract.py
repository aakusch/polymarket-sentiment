"""Versioned scoring contract shared by pipeline exports and status surfaces."""

from __future__ import annotations

SCORING_VERSION = "3.0.0"
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
    "composite": {
        "formula": "event_weighted_average(event_weighted_average(signal_i, market_weight_i), max_market_weight_per_event)",
        "description": "Markets are grouped by event_id. Each event contributes one consolidated signal weighted by its strongest market, preventing event clusters from dominating.",
    },
    "indicator": {
        "formula": "weighted_average(market_or_category_signal, user_weight * market_weight), normalized to 0-100",
        "description": "Builder and API indicators apply user weights on top of base market weights, then optionally blend Fear & Greed.",
    },
    "predictive": {
        "formula": "corr(score_t, price_{t+lag}/price_t - 1), positive signed correlation only",
        "description": "Predictive score measures whether indicator levels lead future reference returns. Inverse correlations are reported but score 0.",
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
