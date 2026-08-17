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
    EXCLUDED_TAG_LABELS,
    GAMMA_EVENTS,
    GAMMA_SEARCH,
    GAMMA_REQ_PER_SEC,
    NOISE_MAX_DURATION_HOURS,
    NOISE_TITLE_PATTERN,
    REQUEST_TIMEOUT,
    SECTOR_QUESTION_PATTERNS,
    SECTOR_TAG_LABELS,
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


_SECTOR_QUESTION_RE: dict[str, list[re.Pattern]] = {
    sector: [re.compile(p, re.IGNORECASE) for p in patterns]
    for sector, patterns in SECTOR_QUESTION_PATTERNS.items()
}


def event_matches_sector(event: Event, sector: str) -> bool:
    """Does this event belong to `sector`?

    Tags first — Polymarket tags them well and the bulk volume feed is dominated
    by sports and esports, which have no business weighting a macro indicator no
    matter what words their questions contain. Untagged events fall back to
    word-boundary patterns over the title and market questions.
    """
    labels = {
        str(t.get("label", "")).strip().lower()
        for t in (event.tags or [])
        if isinstance(t, dict)
    }
    if labels & EXCLUDED_TAG_LABELS:
        return False
    if labels & SECTOR_TAG_LABELS.get(sector, set()):
        return True
    # A tagged event that matched no sector label is a deliberate exclusion:
    # its tags said what it is, and it is not this.
    if labels:
        return False

    patterns = _SECTOR_QUESTION_RE.get(sector, [])
    haystack = " ".join([event.title] + [m.question for m in event.markets])
    return any(p.search(haystack) for p in patterns)


class Discoverer:
    """Discovers crypto markets via the Gamma API."""

    def __init__(self, sector: str = "crypto"):
        self.sector = sector
        self.sector_cfg = SECTORS[sector]
        self._semaphore = asyncio.Semaphore(GAMMA_REQ_PER_SEC)

    async def _get(self, client: httpx.AsyncClient, url: str, params: dict, retries: int = 3) -> dict | list:
        async with self._semaphore:
            for attempt in range(retries):
                try:
                    resp = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
                    resp.raise_for_status()
                    return resp.json()
                except (httpx.TimeoutException, httpx.ConnectError) as e:
                    if attempt == retries - 1:
                        raise
                    wait = 2 ** attempt
                    log.warning("Request failed (attempt %d/%d): %s — retrying in %ds", attempt + 1, retries, e, wait)
                    await asyncio.sleep(wait)

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

    async def _fetch_all_active(
        self, client: httpx.AsyncClient, *, max_events: int = 500, min_volume: float = 50,
    ) -> list[dict]:
        """Fetch ALL active events sorted by 24h volume, stopping when volume drops below threshold."""
        all_events: list[dict] = []
        offset = 0
        limit = 50
        while len(all_events) < max_events:
            params = {
                "limit": limit, "offset": offset,
                "active": "true", "order": "volume24hr", "ascending": "false",
            }
            batch = await self._get(client, GAMMA_EVENTS, params)
            if not isinstance(batch, list) or len(batch) == 0:
                break
            # Stop when volume drops below threshold
            last_vol = float(batch[-1].get("volume24hr", 0) or 0)
            all_events.extend(batch)
            if last_vol < min_volume or len(batch) < limit:
                break
            offset += limit
        log.info("Bulk fetch: %d active events (stopped at offset %d)", len(all_events), offset)
        return all_events

    async def discover(self, *, active_only: bool = True) -> list[Event]:
        """Run all discovery strategies and return deduplicated events.

        Membership is a positive decision. The bulk fetch is a *candidate* pool —
        every active event by volume, which in practice is mostly sports and
        esports — so a bulk-only event has to match this sector to be kept.
        Events that arrived via this sector's own search terms or tag IDs are
        already sector-targeted and are kept as they are.
        """
        events_by_id: dict[str, dict] = {}
        bulk_only: set[str] = set()

        async with httpx.AsyncClient() as client:
            # Candidate pool: all active events by volume. Filtered below.
            bulk_events = await self._fetch_all_active(client)
            for raw_event in bulk_events:
                eid = str(raw_event.get("id", ""))
                if eid:
                    events_by_id[eid] = raw_event
                    bulk_only.add(eid)

            # Supplementary: search-based discovery for niche terms
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
                    if not eid:
                        continue
                    events_by_id.setdefault(eid, raw_event)
                    bulk_only.discard(eid)  # matched this sector's search terms

            # Supplementary: tag-based discovery
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
                    if not eid:
                        continue
                    events_by_id.setdefault(eid, raw_event)
                    bulk_only.discard(eid)  # carries this sector's tag ID

        # Parse into structured objects
        events = [Event.from_raw(raw) for raw in events_by_id.values()]

        # Sector membership: candidates from the bulk pool must match.
        pre_membership = len(events)
        events = [
            e for e in events
            if e.id not in bulk_only or event_matches_sector(e, self.sector)
        ]
        dropped = pre_membership - len(events)
        if dropped:
            log.info(
                "Sector membership[%s]: dropped %d of %d bulk candidates, %d events kept",
                self.sector, dropped, pre_membership, len(events),
            )

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
