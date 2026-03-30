"""Compute per-market sentiment signals, confidence weights, and composite sector scores."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import log1p
from statistics import mean

from classifier import Classification
from collector import OrderBookSnapshot
from config import (
    MAX_LIQUIDITY,
    MAX_OI,
    MAX_VOLUME,
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
        return (prob - 0.5) * 2     # 0.5 -> 0, 1.0 -> +1, 0.0 -> -1
    elif classification.polarity == "bearish":
        return (0.5 - prob) * 2     # Inverted
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


def sector_sentiment(
    markets: list[Market],
    classifications: dict[str, Classification],
    order_books: dict[str, OrderBookSnapshot] | None = None,
    now: datetime | None = None,
) -> SectorScore:
    """Compute the composite sector sentiment score."""
    order_books = order_books or {}
    now = now or datetime.now(timezone.utc)

    market_scores: list[MarketScore] = []
    weighted_sum = 0.0
    total_weight = 0.0

    for m in markets:
        cls = classifications.get(m.id)
        if not cls:
            continue
        ob = order_books.get(m.id)
        ms = score_market(m, cls, ob, now)
        market_scores.append(ms)
        weighted_sum += ms.sentiment_signal * ms.weight
        total_weight += ms.weight

    composite = weighted_sum / total_weight if total_weight > 0 else 0.0
    composite = max(-1.0, min(1.0, composite))

    # Sub-scores by signal type category
    sub_categories = {
        "price_targets": ["price_above", "price_below", "price_range"],
        "regulatory": ["regulatory_positive", "regulatory_negative"],
        "adoption": ["adoption"],
        "events": ["event_positive", "event_negative"],
    }
    sub_scores: dict[str, float] = {}
    for cat_name, types in sub_categories.items():
        cat_markets = [ms for ms in market_scores if ms.classification in types]
        if cat_markets:
            cat_w_sum = sum(ms.sentiment_signal * ms.weight for ms in cat_markets)
            cat_total_w = sum(ms.weight for ms in cat_markets)
            sub_scores[cat_name] = cat_w_sum / cat_total_w if cat_total_w > 0 else 0.0
        else:
            sub_scores[cat_name] = 0.0

    volumes = [ms.volume_24h for ms in market_scores if ms.volume_24h > 0]
    liquidities = [ms.liquidity for ms in market_scores if ms.liquidity > 0]
    bullish_count = sum(1 for ms in market_scores if ms.sentiment_signal > 0.1)

    return SectorScore(
        composite=composite,
        composite_normalized=(composite + 1) * 50,
        market_count=len(market_scores),
        total_volume_24h=sum(ms.volume_24h for ms in market_scores),
        total_open_interest=sum(ms.open_interest for ms in market_scores),
        avg_liquidity=mean(liquidities) if liquidities else 0.0,
        bullish_pct=(bullish_count / len(market_scores) * 100) if market_scores else 0.0,
        volume_concentration=_herfindahl(volumes),
        sub_scores=sub_scores,
        market_scores=market_scores,
    )
