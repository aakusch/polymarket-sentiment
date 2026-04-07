"""Pull order book depth, open interest, and enrichment data from the CLOB API."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx

from config import CLOB_BOOK, CLOB_PRICES_HISTORY, CLOB_REQ_PER_SEC, REQUEST_TIMEOUT
from discovery import Market

log = logging.getLogger(__name__)


@dataclass
class OrderBookSnapshot:
    """Processed order book data for a single token (YES side)."""
    token_id: str
    total_bid_size: float
    total_ask_size: float
    bid_ask_imbalance: float   # [-1, +1] positive = buying pressure
    best_bid: float | None
    best_ask: float | None
    spread: float | None
    depth_levels: int


@dataclass
class PricePoint:
    """A single price history data point."""
    timestamp: int    # unix seconds
    price: float


class Collector:
    """Collects order book and price history data from the CLOB API."""

    def __init__(self):
        self._semaphore = asyncio.Semaphore(CLOB_REQ_PER_SEC)

    async def _get(self, client: httpx.AsyncClient, url: str, params: dict) -> dict | None:
        async with self._semaphore:
            try:
                resp = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                log.warning("CLOB request failed: %s %s — %s", url, params, e)
                return None

    async def fetch_order_book(
        self, client: httpx.AsyncClient, token_id: str
    ) -> OrderBookSnapshot | None:
        """Fetch and process the order book for a single YES token."""
        data = await self._get(client, CLOB_BOOK, {"token_id": token_id})
        if not data:
            return None

        bids = data.get("bids", [])
        asks = data.get("asks", [])

        total_bid = sum(float(b.get("size", 0)) for b in bids)
        total_ask = sum(float(a.get("size", 0)) for a in asks)
        denom = total_bid + total_ask

        imbalance = (total_bid - total_ask) / denom if denom > 0 else 0.0

        best_bid = float(bids[0]["price"]) if bids else None
        best_ask = float(asks[0]["price"]) if asks else None
        spread = (best_ask - best_bid) if (best_bid is not None and best_ask is not None) else None

        return OrderBookSnapshot(
            token_id=token_id,
            total_bid_size=total_bid,
            total_ask_size=total_ask,
            bid_ask_imbalance=imbalance,
            best_bid=best_bid,
            best_ask=best_ask,
            spread=spread,
            depth_levels=max(len(bids), len(asks)),
        )

    async def fetch_price_history(
        self,
        client: httpx.AsyncClient,
        token_id: str,
        *,
        interval: str = "max",
        fidelity: int = 1440,
    ) -> list[PricePoint]:
        """Fetch price history for a token. Returns daily candles by default."""
        data = await self._get(
            client,
            CLOB_PRICES_HISTORY,
            {"market": token_id, "interval": interval, "fidelity": str(fidelity)},
        )
        if not data:
            return []

        history = data.get("history", [])
        return [PricePoint(timestamp=int(h["t"]), price=float(h["p"])) for h in history]

    async def collect_order_books(
        self, markets: list[Market]
    ) -> dict[str, OrderBookSnapshot]:
        """Fetch order books for all markets. Returns dict keyed by market ID."""
        results: dict[str, OrderBookSnapshot] = {}

        async with httpx.AsyncClient() as client:
            tasks = {}
            for m in markets:
                if m.clob_token_ids:
                    # Fetch the YES token's order book (index 0)
                    token_id = m.clob_token_ids[0]
                    tasks[m.id] = self.fetch_order_book(client, token_id)

            if not tasks:
                return results

            market_ids = list(tasks.keys())
            coros = list(tasks.values())
            snapshots = await asyncio.gather(*coros, return_exceptions=True)

            for mid, snap in zip(market_ids, snapshots):
                if isinstance(snap, Exception):
                    log.warning("Order book fetch failed for market %s: %s", mid, snap)
                elif snap is not None:
                    results[mid] = snap

        log.info("Collected %d order books out of %d markets", len(results), len(markets))
        return results

    async def collect_price_histories(
        self,
        markets: list[Market],
        *,
        interval: str = "max",
        fidelity: int = 1440,
    ) -> dict[str, list[PricePoint]]:
        """Fetch price histories for all markets. Returns dict keyed by market ID."""
        results: dict[str, list[PricePoint]] = {}

        async with httpx.AsyncClient() as client:
            tasks = {}
            for m in markets:
                if m.clob_token_ids:
                    token_id = m.clob_token_ids[0]
                    tasks[m.id] = self.fetch_price_history(
                        client, token_id, interval=interval, fidelity=fidelity,
                    )

            if not tasks:
                return results

            market_ids = list(tasks.keys())
            coros = list(tasks.values())
            histories = await asyncio.gather(*coros, return_exceptions=True)

            for mid, hist in zip(market_ids, histories):
                if isinstance(hist, Exception):
                    log.warning("Price history fetch failed for market %s: %s", mid, hist)
                elif hist:
                    results[mid] = hist

        log.info("Collected price histories for %d markets", len(results))
        return results
