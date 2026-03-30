"""Find all markets for a sector via search + tag queries, deduplicated by event ID."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from config import (
    GAMMA_EVENTS,
    GAMMA_SEARCH,
    GAMMA_REQ_PER_SEC,
    NOISE_MAX_DURATION_HOURS,
    NOISE_TITLE_PATTERN,
    REQUEST_TIMEOUT,
    SECTORS,
)

log = logging.getLogger(__name__)


@dataclass
class Market:
    """Flattened representation of a Polymarket market with parsed fields."""
    id: str
    event_id: str
    question: str
    slug: str
    outcomes: list[str]
    outcome_prices: list[float]
    clob_token_ids: list[str]
    volume: float
    volume_24h: float
    liquidity: float
    open_interest: float
    best_bid: float | None
    best_ask: float | None
    spread: float | None
    start_date: str | None
    end_date: str | None
    active: bool
    closed: bool
    neg_risk: bool

    @classmethod
    def from_raw(cls, raw: dict, event_id: str, event_oi: float = 0.0) -> Market:
        """Parse a raw market dict from the Gamma API."""

        def _parse_json_str(val: str | list | None, default: list | None = None) -> list:
            if val is None:
                return default or []
            if isinstance(val, list):
                return val
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return default or []

        outcome_prices_raw = _parse_json_str(raw.get("outcomePrices"), ["0.5", "0.5"])
        outcome_prices = [float(p) for p in outcome_prices_raw]
        clob_ids = _parse_json_str(raw.get("clobTokenIds"), [])

        return cls(
            id=str(raw.get("id", "")),
            event_id=event_id,
            question=raw.get("question", ""),
            slug=raw.get("slug", ""),
            outcomes=_parse_json_str(raw.get("outcomes"), ["Yes", "No"]),
            outcome_prices=outcome_prices,
            clob_token_ids=clob_ids,
            volume=float(raw.get("volumeNum", 0) or raw.get("volume", 0) or 0),
            volume_24h=float(raw.get("volume24hr", 0) or 0),
            liquidity=float(raw.get("liquidityNum", 0) or raw.get("liquidity", 0) or 0),
            open_interest=float(raw.get("openInterest", 0) or 0) or event_oi,
            best_bid=_safe_float(raw.get("bestBid")),
            best_ask=_safe_float(raw.get("bestAsk")),
            spread=_safe_float(raw.get("spread")),
            start_date=raw.get("startDate"),
            end_date=raw.get("endDate"),
            active=bool(raw.get("active", False)),
            closed=bool(raw.get("closed", False)),
            neg_risk=bool(raw.get("negRisk", False)),
        )


@dataclass
class Event:
    """A Polymarket event with nested markets."""
    id: str
    title: str
    slug: str
    volume: float
    volume_24h: float
    liquidity: float
    open_interest: float
    active: bool
    closed: bool
    start_date: str | None
    end_date: str | None
    tags: list[dict]
    markets: list[Market] = field(default_factory=list)

    @classmethod
    def from_raw(cls, raw: dict) -> Event:
        event_id = str(raw.get("id", ""))
        event_oi = float(raw.get("openInterest", 0) or 0)
        num_markets = len(raw.get("markets", []) or [])
        # Split event-level OI evenly across nested markets
        per_market_oi = event_oi / num_markets if num_markets > 0 else 0.0
        raw_markets = raw.get("markets", []) or []
        markets = [Market.from_raw(m, event_id, per_market_oi) for m in raw_markets]
        return cls(
            id=event_id,
            title=raw.get("title", ""),
            slug=raw.get("slug", ""),
            volume=float(raw.get("volume", 0) or 0),
            volume_24h=float(raw.get("volume24hr", 0) or 0),
            liquidity=float(raw.get("liquidityClob", 0) or raw.get("liquidity", 0) or 0),
            open_interest=float(raw.get("openInterest", 0) or 0),
            active=bool(raw.get("active", False)),
            closed=bool(raw.get("closed", False)),
            start_date=raw.get("startDate"),
            end_date=raw.get("endDate"),
            tags=raw.get("tags", []) or [],
            markets=markets,
        )


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _is_noise_event(event: Event) -> bool:
    """Check if an event is short-duration noise (e.g. 5-min 'Up or Down' binary bets)."""
    if not re.search(NOISE_TITLE_PATTERN, event.title):
        return False
    # Check duration: if start and end are both set and within threshold, it's noise
    if event.start_date and event.end_date:
        try:
            start = datetime.fromisoformat(event.start_date.replace("Z", "+00:00"))
            end = datetime.fromisoformat(event.end_date.replace("Z", "+00:00"))
            duration_hours = (end - start).total_seconds() / 3600
            if duration_hours < NOISE_MAX_DURATION_HOURS:
                return True
        except (ValueError, TypeError):
            pass
    return False


class Discoverer:
    """Discovers crypto markets via the Gamma API."""

    def __init__(self, sector: str = "crypto"):
        self.sector_cfg = SECTORS[sector]
        self._semaphore = asyncio.Semaphore(GAMMA_REQ_PER_SEC)

    async def _get(self, client: httpx.AsyncClient, url: str, params: dict) -> dict | list:
        async with self._semaphore:
            resp = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp.json()

    async def _search_term(self, client: httpx.AsyncClient, term: str) -> list[dict]:
        """Search for events by keyword. Returns up to 5 events (API limit)."""
        data = await self._get(client, GAMMA_SEARCH, {"q": term})
        return data.get("events", []) if isinstance(data, dict) else []

    async def _fetch_tag_events(
        self, client: httpx.AsyncClient, tag_id: int, *, active_only: bool = True
    ) -> list[dict]:
        """Fetch events for a tag, sorted by 24h volume descending, capped at 500."""
        all_events: list[dict] = []
        offset = 0
        limit = 50
        max_events = 500  # Cap per tag to avoid crawling thousands
        while len(all_events) < max_events:
            params: dict = {
                "tag_id": tag_id, "limit": limit, "offset": offset,
                "order": "volume24hr", "ascending": "false",
            }
            if active_only:
                params["active"] = "true"
            batch = await self._get(client, GAMMA_EVENTS, params)
            if not isinstance(batch, list) or len(batch) == 0:
                break
            all_events.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
        return all_events[:max_events]

    async def discover(self, *, active_only: bool = True) -> list[Event]:
        """Run all discovery strategies and return deduplicated events."""
        events_by_id: dict[str, dict] = {}

        async with httpx.AsyncClient() as client:
            # Search-based discovery (all terms in parallel)
            search_tasks = [
                self._search_term(client, term)
                for term in self.sector_cfg["search_terms"]
            ]
            search_results = await asyncio.gather(*search_tasks, return_exceptions=True)

            for result in search_results:
                if isinstance(result, Exception):
                    log.warning("Search failed: %s", result)
                    continue
                for raw_event in result:
                    eid = str(raw_event.get("id", ""))
                    if eid and eid not in events_by_id:
                        events_by_id[eid] = raw_event

            # Tag-based discovery (all tags in parallel)
            tag_tasks = [
                self._fetch_tag_events(client, tag_id, active_only=active_only)
                for tag_id in self.sector_cfg["tag_ids"]
            ]
            tag_results = await asyncio.gather(*tag_tasks, return_exceptions=True)

            for result in tag_results:
                if isinstance(result, Exception):
                    log.warning("Tag fetch failed: %s", result)
                    continue
                for raw_event in result:
                    eid = str(raw_event.get("id", ""))
                    if eid and eid not in events_by_id:
                        events_by_id[eid] = raw_event

        # Parse into structured objects
        events = [Event.from_raw(raw) for raw in events_by_id.values()]

        if active_only:
            events = [e for e in events if e.active]

        # Filter out noise markets (short-duration binary bets)
        pre_filter = len(events)
        events = [e for e in events if not _is_noise_event(e)]
        noise_count = pre_filter - len(events)
        if noise_count:
            log.info("Filtered %d noise events (short-duration binary bets)", noise_count)

        # Flatten and count markets
        total_markets = sum(len(e.markets) for e in events)
        log.info(
            "Discovered %d events with %d markets (active_only=%s)",
            len(events), total_markets, active_only,
        )
        return events


async def discover_crypto_markets(*, active_only: bool = True) -> list[Event]:
    """Convenience function for crypto sector discovery."""
    return await Discoverer("crypto").discover(active_only=active_only)


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    events = asyncio.run(discover_crypto_markets())
    total = sum(len(e.markets) for e in events)
    print(f"Found {len(events)} events, {total} markets")
    for e in sorted(events, key=lambda x: x.volume_24h, reverse=True)[:10]:
        print(f"  [{e.id}] {e.title} (${e.volume_24h:,.0f} 24h vol, {len(e.markets)} markets)")
        for m in e.markets[:3]:
            print(f"    - {m.question}  YES={m.outcome_prices[0]:.3f}")
