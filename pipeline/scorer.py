"""Compute per-market sentiment signals, confidence weights, and composite sector scores."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import log1p, tanh
from statistics import mean

from classifier import Classification
from collector import OrderBookSnapshot
from config import (
    MAX_LIQUIDITY,
    MIN_CLASSIFIED_PCT,
    MIN_SCORED_MARKETS,
    MAX_OI,
    MAX_VOLUME,
    NOISE_QUESTION_PATTERNS,
    RESOLVED_PROB_HIGH,
    RESOLVED_PROB_LOW,
    SIGNAL_COMPRESSION_K,
    TIME_DECAY_HORIZON_DAYS,
    WEIGHT_LIQUIDITY,
    WEIGHT_OI,
    WEIGHT_TIME_DECAY,
    WEIGHT_VOLUME,
)
from discovery import Market

log = logging.getLogger(__name__)


@dataclass
class MarketScore:
    """Scored output for a single market."""
    market_id: str
    event_id: str
    question: str
    classification: str
    polarity: str
    probability: float
    sentiment_signal: float   # [-1, +1]
    weight: float             # [0, 1]
    volume_24h: float
    liquidity: float
    open_interest: float
    bid_ask_imbalance: float
    asset: str = "OTHER"
    end_date: str | None = None


@dataclass
class SectorScore:
    """Composite sentiment score for a sector."""
    composite: float               # [-1, +1]
    composite_normalized: float    # [0, 100]
    market_count: int
    total_volume_24h: float
    total_open_interest: float
    avg_liquidity: float
    bullish_pct: float             # % of markets with signal > 0.1
    volume_concentration: float    # Herfindahl index
    sub_scores: dict[str, float] = field(default_factory=dict)
    market_scores: list[MarketScore] = field(default_factory=list)
    scored_market_count: int = 0   # markets that actually moved the composite
    classified_pct: float = 0.0    # % of observed markets carrying a direction
    coverage_ok: bool = True       # False → too thin to present as a reading


_noise_q_re = [re.compile(p) for p in NOISE_QUESTION_PATTERNS]

SUB_CATEGORY_TYPES = {
    "crypto": {
        "price_targets": ["price_above", "price_below", "price_range"],
        "regulatory": ["regulatory_positive", "regulatory_negative"],
        "adoption": ["adoption"],
        "events": ["event_positive", "event_negative"],
    },
    "stocks": {
        "price_targets": ["price_above", "price_below", "price_range"],
        "earnings": ["earnings_positive", "earnings_negative"],
        "corporate": ["corporate_positive", "corporate_negative"],
    },
    "economy": {
        "monetary_policy": ["monetary_dovish", "monetary_hawkish"],
        "inflation": ["inflation_rising", "inflation_falling"],
        "growth": ["growth_positive", "growth_negative"],
        "employment": ["employment_positive", "employment_negative"],
    },
    "politics": {
        "favors_incumbent": ["favors_incumbent"],
        "favors_challenger": ["favors_challenger"],
        "legislative": ["legislative_positive", "legislative_negative"],
        "judicial": ["judicial_event"],
        "geopolitical": ["geopolitical_event", "geopolitical_deescalation"],
    },
}


def _is_noise_market(question: str) -> bool:
    """Return True if the market question matches a noise pattern."""
    return any(pat.search(question) for pat in _noise_q_re)


def market_sentiment(market: Market, classification: Classification) -> float:
    """Compute directional sentiment signal for a market. Returns [-1, +1]."""
    if not market.outcome_prices:
        return 0.0

    # Neutral polarity (e.g. price_range) contributes weight but no directional signal
    if classification.polarity == "neutral":
        return 0.0

    prob = market.outcome_prices[0]  # YES probability
    prob = max(0.0, min(1.0, prob))  # clamp

    if classification.polarity == "bullish":
        return tanh(SIGNAL_COMPRESSION_K * (prob - 0.5))
    elif classification.polarity == "bearish":
        return tanh(SIGNAL_COMPRESSION_K * (0.5 - prob))
    return 0.0


def market_weight(market: Market, now: datetime | None = None) -> float:
    """Compute confidence weight for a market. Returns [0, ~1]."""
    now = now or datetime.now(timezone.utc)

    volume_score = log1p(market.volume_24h) / log1p(MAX_VOLUME) if MAX_VOLUME > 0 else 0
    liquidity_score = log1p(market.liquidity) / log1p(MAX_LIQUIDITY) if MAX_LIQUIDITY > 0 else 0
    oi_score = log1p(market.open_interest) / log1p(MAX_OI) if MAX_OI > 0 else 0

    # Time decay: markets near expiry get less weight (less forward-looking)
    time_decay = 1.0
    if market.end_date:
        try:
            end_dt = datetime.fromisoformat(market.end_date.replace("Z", "+00:00"))
            days_to_expiry = (end_dt - now).days
            time_decay = min(1.0, max(0.0, days_to_expiry / TIME_DECAY_HORIZON_DAYS))
        except (ValueError, TypeError):
            pass

    weight = (
        WEIGHT_VOLUME * volume_score
        + WEIGHT_LIQUIDITY * liquidity_score
        + WEIGHT_OI * oi_score
        + WEIGHT_TIME_DECAY * time_decay
    )
    return max(0.001, weight)  # Floor to avoid zero weights


def _herfindahl(values: list[float]) -> float:
    """Herfindahl-Hirschman index for concentration. Returns [0, 1]."""
    total = sum(values)
    if total <= 0 or len(values) == 0:
        return 0.0
    shares = [v / total for v in values]
    return sum(s * s for s in shares)


def score_market(
    market: Market,
    classification: Classification,
    order_book: OrderBookSnapshot | None = None,
    now: datetime | None = None,
) -> MarketScore:
    """Score a single market."""
    signal = market_sentiment(market, classification)
    weight = market_weight(market, now)
    imbalance = order_book.bid_ask_imbalance if order_book else 0.0

    return MarketScore(
        market_id=market.id,
        event_id=market.event_id,
        question=market.question,
        classification=classification.signal_type,
        polarity=classification.polarity,
        probability=market.outcome_prices[0] if market.outcome_prices else 0.5,
        sentiment_signal=signal,
        weight=weight,
        volume_24h=market.volume_24h,
        liquidity=market.liquidity,
        open_interest=market.open_interest,
        bid_ask_imbalance=imbalance,
        asset=getattr(classification, "asset", "OTHER"),
        end_date=market.end_date,
    )


def _event_deduped_composite(scores: list[MarketScore]) -> float:
    """Compute weighted average after consolidating markets within the same event.

    Each event group is reduced to a single intra-group weighted average signal.
    The consolidated event then contributes one confidence weight, capped at the
    strongest constituent market weight, so duplicate markets in the same event
    cannot dominate the composite merely by being numerous.
    """
    if not scores:
        return 0.0

    by_event: dict[str, list[MarketScore]] = defaultdict(list)
    for ms in scores:
        by_event[ms.event_id or ms.market_id].append(ms)

    weighted_sum = 0.0
    total_weight = 0.0
    for _eid, group in by_event.items():
        g_w_sum = sum(ms.sentiment_signal * ms.weight for ms in group)
        g_total_w = sum(ms.weight for ms in group)
        if g_total_w > 0:
            consolidated_signal = g_w_sum / g_total_w
            event_weight = max(ms.weight for ms in group)
            weighted_sum += consolidated_signal * event_weight
            total_weight += event_weight

    return weighted_sum / total_weight if total_weight > 0 else 0.0


def _is_directional(ms: MarketScore) -> bool:
    """True when a market carries a direction and belongs in a directional composite.

    Unclassified markets used to sit in the denominator with signal 0, so the
    composite was a real signal from a few dozen markets divided by the weight of
    a thousand-plus that said nothing. That dragged every sector to the midpoint —
    crypto 47.3, economy 47.5, stocks 47.6, politics 47.8, four "independent"
    indicators agreeing to within half a point. price_range markets are neutral by
    construction and belong in coverage, not in a directional average either.
    """
    return ms.classification not in ("unclassified", "price_range")


def sector_score_from_market_scores(market_scores: list[MarketScore], sector: str = "crypto") -> SectorScore:
    """Build a SectorScore from pre-scored markets using canonical aggregation.

    `market_count` stays the full observed set — it describes coverage — while the
    composite is computed only over directional markets, and `classified_pct`
    reports the gap between the two instead of hiding it in the denominator.
    """
    directional = [ms for ms in market_scores if _is_directional(ms)]

    composite = _event_deduped_composite(directional)
    composite = max(-1.0, min(1.0, composite))

    sub_categories = SUB_CATEGORY_TYPES.get(sector, SUB_CATEGORY_TYPES["crypto"])
    sub_scores: dict[str, float] = {}
    for cat_name, types in sub_categories.items():
        cat_markets = [ms for ms in directional if ms.classification in types]
        sub_scores[cat_name] = _event_deduped_composite(cat_markets) if cat_markets else 0.0

    volumes = [ms.volume_24h for ms in market_scores if ms.volume_24h > 0]
    liquidities = [ms.liquidity for ms in market_scores if ms.liquidity > 0]
    bullish_count = sum(1 for ms in directional if ms.sentiment_signal > 0.1)
    classified_pct = (len(directional) / len(market_scores) * 100) if market_scores else 0.0

    return SectorScore(
        composite=composite,
        composite_normalized=(composite + 1) * 50,
        market_count=len(market_scores),
        total_volume_24h=sum(ms.volume_24h for ms in market_scores),
        total_open_interest=sum(ms.open_interest for ms in market_scores),
        avg_liquidity=mean(liquidities) if liquidities else 0.0,
        bullish_pct=(bullish_count / len(directional) * 100) if directional else 0.0,
        volume_concentration=_herfindahl(volumes),
        sub_scores=sub_scores,
        market_scores=market_scores,
        scored_market_count=len(directional),
        classified_pct=classified_pct,
        coverage_ok=(
            len(directional) >= MIN_SCORED_MARKETS
            and classified_pct >= MIN_CLASSIFIED_PCT
        ),
    )


def sector_sentiment(
    markets: list[Market],
    classifications: dict[str, Classification],
    order_books: dict[str, OrderBookSnapshot] | None = None,
    now: datetime | None = None,
    sector: str = "crypto",
) -> SectorScore:
    """Compute the composite sector sentiment score."""
    order_books = order_books or {}
    now = now or datetime.now(timezone.utc)

    market_scores: list[MarketScore] = []
    for m in markets:
        cls = classifications.get(m.id)
        if not cls:
            continue

        # A1: Skip effectively resolved markets
        prob = m.outcome_prices[0] if m.outcome_prices else 0.5
        if prob <= RESOLVED_PROB_LOW or prob >= RESOLVED_PROB_HIGH:
            continue

        # A2: Skip noise markets (e.g. "Up or Down" coin flips)
        if _is_noise_market(m.question):
            continue

        ob = order_books.get(m.id)
        ms = score_market(m, cls, ob, now)
        market_scores.append(ms)

    # A5: Event-deduplicated composite and sub-scores
    return sector_score_from_market_scores(market_scores, sector=sector)
