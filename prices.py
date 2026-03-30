"""Fetch and cache BTC price and Fear & Greed Index from free APIs."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart"
FNG_URL = "https://api.alternative.me/fng/"


async def fetch_btc_prices(days: int = 90) -> list[tuple[str, float]]:
    """Fetch daily BTC prices from CoinGecko. Returns [(date_str, price), ...]."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            COINGECKO_URL,
            params={"vs_currency": "usd", "days": days, "interval": "daily"},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for ts_ms, price in data.get("prices", []):
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d")
        results.append((date_str, round(price, 2)))
    log.info("Fetched %d BTC daily prices from CoinGecko", len(results))
    return results


async def fetch_fear_greed(days: int = 90) -> list[tuple[str, int]]:
    """Fetch Fear & Greed Index from Alternative.me. Returns [(date_str, value), ...]."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            FNG_URL,
            params={"limit": days, "format": "json"},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for entry in data.get("data", []):
        ts = int(entry["timestamp"])
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d")
        results.append((date_str, int(entry["value"])))
    log.info("Fetched %d Fear & Greed values from Alternative.me", len(results))
    return results


async def update_reference_prices(db, days: int = 90):
    """Fetch and save both BTC prices and Fear & Greed Index via Database object."""
    btc = await fetch_btc_prices(days)
    fng = await fetch_fear_greed(days)
    db.save_reference_prices(btc, fng)


if __name__ == "__main__":
    import asyncio

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")

    from db import Database

    async def _main():
        db = Database()
        with db:
            await update_reference_prices(db, days=90)

    asyncio.run(_main())
