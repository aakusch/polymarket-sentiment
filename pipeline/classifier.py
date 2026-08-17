"""Classify markets into signal types that determine bullish/bearish mapping."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache

from config import ASSET_PATTERNS, STOCK_ASSET_PATTERNS, SECTOR_RULES
from discovery import Market

log = logging.getLogger(__name__)


def extract_asset(question: str, sector: str = "crypto") -> str:
    """Extract the primary asset from a market question. Returns ticker or 'OTHER'.

    For non-crypto sectors, also checks STOCK_ASSET_PATTERNS and falls back to
    a sector default instead of 'OTHER'. Crypto tickers (BTC, ETH, etc.) are
    remapped to the sector default when sector is not crypto, preventing
    crypto-market leakage into other sectors.
    """
    _SECTOR_DEFAULT_ASSET = {
        "stocks": "MARKET",
        "economy": "MACRO",
        "politics": "GOV",
    }
    q_lower = question.lower()
    # Always check crypto patterns
    for ticker, pattern in ASSET_PATTERNS.items():
        if re.search(pattern, q_lower):
            # If non-crypto sector matched a crypto ticker, remap to sector default
            if sector != "crypto":
                return _SECTOR_DEFAULT_ASSET.get(sector, "OTHER")
            return ticker
    # For non-crypto sectors, also check stock/macro patterns
    if sector != "crypto":
        for ticker, pattern in STOCK_ASSET_PATTERNS.items():
            if re.search(pattern, q_lower):
                return ticker
    return _SECTOR_DEFAULT_ASSET.get(sector, "OTHER")


@dataclass
class Classification:
    """How a market's probability maps to sentiment."""
    market_id: str
    question: str
    signal_type: str     # e.g. "price_above", "regulatory_negative"
    polarity: str        # "bullish" or "bearish"
    method: str          # "keyword", "llm", or "manual"
    asset: str = "OTHER" # e.g. "BTC", "ETH", "SOL"


# Manual overrides: market_id -> (signal_type, polarity)
MANUAL_OVERRIDES: dict[str, tuple[str, str]] = {}


_KEYWORD_GAP_WORDS = 2


def _keyword_pattern(keyword: str) -> str:
    """Word-boundary pattern for a keyword, tolerating a little filler.

    Real questions rarely contain the bare phrase: the rule says "inflation
    above" but the market asks "Will CPI inflation be above 3%?". Allow up to
    _KEYWORD_GAP_WORDS words between the terms so phrase rules actually fire,
    while still requiring every term, in order, on word boundaries.
    """
    terms = [re.escape(t) for t in keyword.split()]
    gap = rf"(?:\W+\w+){{0,{_KEYWORD_GAP_WORDS}}}\W+"
    return r"\b" + gap.join(terms) + r"\b"


@lru_cache(maxsize=None)
def _compiled_rules(sector: str) -> tuple[tuple[re.Pattern, int, str, str], ...]:
    """Compile a sector's rules to word-boundary regexes, longest keyword first.

    Word boundaries matter more than they look. The old matcher used plain
    substring containment, so "g(over)nment shutdown" and "W(hit)e House" both
    matched the bullish price-target rule, and "JPMorgan (ban)k" matched
    regulatory_negative.
    """
    rules = SECTOR_RULES.get(sector, SECTOR_RULES["crypto"])
    compiled: list[tuple[re.Pattern, int, str, str]] = []
    for keywords, signal_type, polarity in rules:
        for kw in keywords:
            compiled.append((
                re.compile(_keyword_pattern(kw)), len(kw), signal_type, polarity,
            ))
    # Longest keyword first, so specificity — not list order — picks the winner.
    compiled.sort(key=lambda r: r[1], reverse=True)
    return tuple(compiled)


def classify_by_keywords(question: str, sector: str = "crypto") -> tuple[str, str] | None:
    """Classify a market question using that sector's keyword rules.

    The most specific match wins ("inflation above" beats "above"), and a tie
    between two different signal types at equal specificity is ambiguous rather
    than silently resolved by list order. Returns (signal_type, polarity), or
    None when nothing matches or the match is ambiguous.
    """
    q_lower = question.lower()
    best_len = 0
    winners: set[tuple[str, str]] = set()
    for pattern, kw_len, signal_type, polarity in _compiled_rules(sector):
        if kw_len < best_len:
            break  # sorted by length — nothing further can beat the current best
        if pattern.search(q_lower):
            best_len = kw_len
            winners.add((signal_type, polarity))
    if len(winners) == 1:
        return next(iter(winners))
    if len(winners) > 1:
        log.debug("Ambiguous classification (%s): %r -> %s", sector, question, winners)
    return None


def classify_market(market: Market, sector: str = "crypto") -> Classification:
    """Classify a single market. Uses keyword rules, falls back to neutral default."""
    asset = extract_asset(market.question, sector=sector)

    # Check manual overrides first
    if market.id in MANUAL_OVERRIDES:
        sig_type, polarity = MANUAL_OVERRIDES[market.id]
        return Classification(
            market_id=market.id,
            question=market.question,
            signal_type=sig_type,
            polarity=polarity,
            method="manual",
            asset=asset,
        )

    # Try keyword-based classification
    result = classify_by_keywords(market.question, sector=sector)
    if result:
        sig_type, polarity = result
        return Classification(
            market_id=market.id,
            question=market.question,
            signal_type=sig_type,
            polarity=polarity,
            method="keyword",
            asset=asset,
        )

    # Default: unclassified markets are neutral (no directional signal)
    return Classification(
        market_id=market.id,
        question=market.question,
        signal_type="unclassified",
        polarity="neutral",
        method="keyword",
        asset=asset,
    )


def classify_batch(markets: list[Market], sector: str = "crypto") -> dict[str, Classification]:
    """Classify all markets. Returns dict keyed by market ID."""
    classifications: dict[str, Classification] = {}
    method_counts: dict[str, int] = {}

    for m in markets:
        c = classify_market(m, sector=sector)
        classifications[m.id] = c
        method_counts[c.method] = method_counts.get(c.method, 0) + 1

    type_counts: dict[str, int] = {}
    for c in classifications.values():
        type_counts[c.signal_type] = type_counts.get(c.signal_type, 0) + 1

    log.info(
        "Classified %d markets — methods: %s, types: %s",
        len(classifications), method_counts, type_counts,
    )
    return classifications


async def classify_batch_with_llm(
    markets: list[Market],
    keyword_results: dict[str, Classification],
) -> dict[str, Classification]:
    """Re-classify unclassified markets using Claude. Updates in place.

    Requires ANTHROPIC_API_KEY env var.
    """
    unclassified = [
        m for m in markets
        if keyword_results.get(m.id, Classification("", "", "unclassified", "bullish", "keyword")).signal_type == "unclassified"
    ]

    if not unclassified:
        log.info("No unclassified markets — skipping LLM classification")
        return keyword_results

    try:
        import anthropic
    except ImportError:
        log.warning("anthropic package not installed — skipping LLM classification")
        return keyword_results

    client = anthropic.Anthropic()

    # Batch into groups of 20 for efficiency
    batch_size = 20
    for i in range(0, len(unclassified), batch_size):
        batch = unclassified[i : i + batch_size]
        questions_text = "\n".join(
            f"{j+1}. [id={m.id}] {m.question}" for j, m in enumerate(batch)
        )

        prompt = f"""Classify each prediction market question into exactly one category and polarity.

Categories:
- price_above (bullish): Market asks if price will be ABOVE a target
- price_below (bearish): Market asks if price will be BELOW a target
- adoption (bullish): Market asks about adoption milestones
- regulatory_positive (bullish): Market asks about positive regulation
- regulatory_negative (bearish): Market asks about negative regulation
- event_positive (bullish): Market asks about positive events
- event_negative (bearish): Market asks about negative events

For each market, respond with ONLY: id|signal_type|polarity
One per line, no other text.

Markets:
{questions_text}"""

        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            lines = response.content[0].text.strip().split("\n")
            for line in lines:
                parts = line.strip().split("|")
                if len(parts) == 3:
                    mid, sig_type, polarity = parts
                    mid = mid.strip()
                    if mid in keyword_results:
                        keyword_results[mid] = Classification(
                            market_id=mid,
                            question=keyword_results[mid].question,
                            signal_type=sig_type.strip(),
                            polarity=polarity.strip(),
                            method="llm",
                            asset=keyword_results[mid].asset,
                        )
        except Exception as e:
            log.warning("LLM classification batch failed: %s", e)

    llm_count = sum(1 for c in keyword_results.values() if c.method == "llm")
    log.info("LLM classified %d additional markets", llm_count)
    return keyword_results
