"""Fetch and cache reference prices from free APIs (CoinGecko, Yahoo Finance, FRED, Alternative.me)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)

COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart"
FNG_URL = "https://api.alternative.me/fng/"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


# ── Individual fetchers ──────────────────────────────────────────────────────

async def fetch_coingecko(days: int = 365, coin: str = "bitcoin") -> list[tuple[str, float]]:
    """Fetch daily prices from CoinGecko. Returns [(date_str, price), ...]."""
    url = f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
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
    log.info("Fetched %d %s daily prices from CoinGecko", len(results), coin)
    return results


async def fetch_fng(days: int = 365) -> list[tuple[str, int]]:
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


async def fetch_yahoo(days: int = 365, symbol: str = "^GSPC") -> list[tuple[str, float]]:
    """Fetch daily prices from Yahoo Finance. Returns [(date_str, price), ...]."""
    # Yahoo Finance uses range strings
    if days <= 7:
        range_str = "5d"
    elif days <= 30:
        range_str = "1mo"
    elif days <= 90:
        range_str = "3mo"
    elif days <= 180:
        range_str = "6mo"
    elif days <= 365:
        range_str = "1y"
    elif days <= 730:
        range_str = "2y"
    else:
        range_str = "5y"

    url = YAHOO_CHART_URL.format(symbol=symbol)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"interval": "1d", "range": range_str},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()

    result_data = data.get("chart", {}).get("result", [])
    if not result_data:
        log.warning("No Yahoo data for %s", symbol)
        return []

    timestamps = result_data[0].get("timestamp", [])
    closes = result_data[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])

    results = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d")
        results.append((date_str, round(float(close), 4)))
    log.info("Fetched %d daily prices for %s from Yahoo Finance", len(results), symbol)
    return results


async def fetch_fred(days: int = 365, series_id: str = "FEDFUNDS") -> list[tuple[str, float]]:
    """Fetch economic data from FRED API. Returns [(date_str, value), ...]."""
    api_key = os.environ.get("FRED_API_KEY", "")
    if not api_key:
        # Try loading from .env
        try:
            from dotenv import load_dotenv
            load_dotenv()
            api_key = os.environ.get("FRED_API_KEY", "")
        except ImportError:
            pass
    if not api_key:
        log.warning("FRED_API_KEY not set — skipping FRED data for %s", series_id)
        return []

    from datetime import timedelta
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            FRED_URL,
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "observation_start": start.strftime("%Y-%m-%d"),
                "observation_end": end.strftime("%Y-%m-%d"),
                "sort_order": "asc",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for obs in data.get("observations", []):
        val = obs.get("value")
        if val is None or val == ".":
            continue
        results.append((obs["date"], round(float(val), 4)))
    log.info("Fetched %d observations for %s from FRED", len(results), series_id)
    return results


# ── Sector feed orchestration ────────────────────────────────────────────────

SECTOR_FEEDS: dict[str, list[tuple[str, callable, ...]]] = {
    "crypto": [
        ("btc_price", fetch_coingecko, {"coin": "bitcoin"}),
        ("eth_price", fetch_coingecko, {"coin": "ethereum"}),
        ("sol_price", fetch_coingecko, {"coin": "solana"}),
        ("fear_greed", fetch_fng, {}),
    ],
    "stocks": [
        ("spx_price", fetch_yahoo, {"symbol": "^GSPC"}),
        ("ndx_price", fetch_yahoo, {"symbol": "^NDX"}),
        ("dji_price", fetch_yahoo, {"symbol": "^DJI"}),
        ("rut_price", fetch_yahoo, {"symbol": "^RUT"}),
        ("vix_price", fetch_yahoo, {"symbol": "^VIX"}),
    ],
    "economy": [
        ("us10y_yield", fetch_yahoo, {"symbol": "^TNX"}),
        ("us2y_yield", fetch_yahoo, {"symbol": "2YY=F"}),
        ("dxy_price", fetch_yahoo, {"symbol": "DX-Y.NYB"}),
        ("fed_rate", fetch_fred, {"series_id": "FEDFUNDS"}),
        ("unemployment", fetch_fred, {"series_id": "UNRATE"}),
    ],
    "commodities": [
        ("gold_price", fetch_yahoo, {"symbol": "GC=F"}),
        ("oil_price", fetch_yahoo, {"symbol": "CL=F"}),
    ],
    "politics": [],
}


async def update_reference_prices(db, *, sector: str = "crypto", days: int = 365):
    """Fetch and save reference prices for the given sector via Database object.

    Always includes commodities feeds (gold, oil) since they're cross-sector reference data.
    """
    feeds = list(SECTOR_FEEDS.get(sector, []))
    # Always include commodities as cross-sector reference data
    if sector != "commodities":
        feeds.extend(SECTOR_FEEDS.get("commodities", []))
    if not feeds:
        log.info("No reference feeds for sector '%s'", sector)
        return

    all_feeds: dict[str, list[tuple[str, float]]] = {}
    for feed_name, fetcher, kwargs in feeds:
        try:
            data = await fetcher(days=days, **kwargs)
            all_feeds[feed_name] = data
            log.info("Feed '%s': %d data points", feed_name, len(data))
        except Exception as e:
            log.warning("Feed '%s' failed (non-fatal): %s", feed_name, e)
            all_feeds[feed_name] = []

    db.save_reference_prices(all_feeds)


# ── Legacy shims ─────────────────────────────────────────────────────────────

async def fetch_btc_prices(days: int = 90) -> list[tuple[str, float]]:
    """Legacy shim — delegates to fetch_coingecko."""
    return await fetch_coingecko(days=days, coin="bitcoin")


async def fetch_fear_greed(days: int = 90) -> list[tuple[str, int]]:
    """Legacy shim — delegates to fetch_fng."""
    return await fetch_fng(days=days)


if __name__ == "__main__":
    import asyncio

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")

    from db import Database

    async def _main():
        db = Database()
        with db:
            for s in ["crypto", "stocks", "economy"]:
                print(f"\n--- {s} ---")
                await update_reference_prices(db, sector=s, days=365)

    asyncio.run(_main())
