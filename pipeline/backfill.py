"""Historical backfill using /prices-history to reconstruct past sentiment scores."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, timezone
from math import tanh

import click

from classifier import classify_batch
from collector import Collector, PricePoint
from config import (
    BACKFILL_FIDELITY,
    BACKFILL_INTERVAL,
    RESOLVED_PROB_HIGH,
    RESOLVED_PROB_LOW,
    SIGNAL_COMPRESSION_K,
)
from db import Database
from discovery import Discoverer, Market
from scorer import MarketScore, _is_noise_market, market_weight, sector_score_from_market_scores

log = logging.getLogger(__name__)


def _score_from_price(
    market: Market,
    price: float,
    polarity: str,
    classification: str,
    weight: float,
    asset: str = "OTHER",
) -> MarketScore:
    """Create a MarketScore from a historical price point."""
    prob = max(0.0, min(1.0, price))
    if polarity == "bullish":
        signal = tanh(SIGNAL_COMPRESSION_K * (prob - 0.5))
    elif polarity == "bearish":
        signal = tanh(SIGNAL_COMPRESSION_K * (0.5 - prob))
    else:
        signal = 0.0

    return MarketScore(
        market_id=market.id,
        event_id=market.event_id,
        question=market.question,
        classification=classification,
        polarity=polarity,
        probability=prob,
        sentiment_signal=signal,
        weight=weight,
        volume_24h=market.volume_24h,
        liquidity=market.liquidity,
        open_interest=market.open_interest,
        bid_ask_imbalance=0.0,
        asset=asset,
        end_date=market.end_date,
    )


async def run_backfill(
    sector: str = "crypto",
    *,
    db_path: str | None = None,
    start_date: str | None = None,
) -> dict:
    """Backfill historical sentiment scores from price history data.

    Discovers all crypto markets (including closed), fetches their full price
    histories, groups by date, and computes daily composite scores.
    """
    log.info("Starting backfill for sector=%s", sector)

    # 1. Discover ALL markets (including closed ones for historical coverage)
    discoverer = Discoverer(sector)
    events = await discoverer.discover(active_only=False)
    all_markets = [m for e in events for m in e.markets]
    markets_by_id = {m.id: m for m in all_markets}
    log.info("Found %d total markets (active + closed)", len(all_markets))

    if not all_markets:
        return {"error": "no_markets"}

    # 2. Classify all markets
    classifications = classify_batch(all_markets)

    # 3. Fetch price histories
    log.info("Fetching price histories...")
    collector = Collector()
    histories = await collector.collect_price_histories(
        all_markets,
        interval=BACKFILL_INTERVAL,
        fidelity=BACKFILL_FIDELITY,
    )
    log.info("Got price histories for %d markets", len(histories))

    # 4. Group prices by date
    # date_str -> list of (market_id, price)
    prices_by_date: dict[str, list[tuple[str, float]]] = defaultdict(list)

    for market_id, points in histories.items():
        for pt in points:
            dt = datetime.fromtimestamp(pt.timestamp, tz=timezone.utc)
            d = dt.strftime("%Y-%m-%d")
            if start_date and d < start_date:
                continue
            prices_by_date[d].append((market_id, pt.price))

    dates = sorted(prices_by_date.keys())
    log.info("Price data spans %d dates: %s to %s", len(dates), dates[0] if dates else "?", dates[-1] if dates else "?")

    # 5. Compute and store daily scores
    db = Database(db_path)
    with db:
        db.save_classifications(classifications)

        for d in dates:
            market_prices = prices_by_date[d]
            market_scores: list[MarketScore] = []
            for market_id, price in market_prices:
                market = markets_by_id.get(market_id)
                cls = classifications.get(market_id)
                if not market or not cls:
                    continue

                prob = max(0.0, min(1.0, price))
                if prob <= RESOLVED_PROB_LOW or prob >= RESOLVED_PROB_HIGH:
                    continue
                if _is_noise_market(market.question):
                    continue

                weight = market_weight(market)
                ms = _score_from_price(market, price, cls.polarity, cls.signal_type, weight,
                                       asset=getattr(cls, "asset", "OTHER"))
                market_scores.append(ms)

            if not market_scores:
                continue

            score = sector_score_from_market_scores(market_scores, sector=sector)
            db.save_snapshot(d, sector, score)

        log.info("Backfill complete: %d dates written", len(dates))

    return {
        "dates_filled": len(dates),
        "markets_with_history": len(histories),
        "date_range": f"{dates[0]} to {dates[-1]}" if dates else "none",
    }


@click.command()
@click.option("--sector", default="crypto", help="Sector to backfill")
@click.option("--db", "db_path", default=None, help="Database path")
@click.option("--start", "start_date", default=None, help="Start date (YYYY-MM-DD)")
@click.option("-v", "--verbose", is_flag=True, help="Verbose logging")
def main(sector: str, db_path: str | None, start_date: str | None, verbose: bool):
    """Backfill historical sentiment scores from price history."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    result = asyncio.run(run_backfill(sector, db_path=db_path, start_date=start_date))

    if "error" in result:
        click.echo(f"Backfill failed: {result['error']}")
        raise SystemExit(1)

    click.echo(f"\nBackfill complete:")
    click.echo(f"  Dates: {result['dates_filled']}")
    click.echo(f"  Markets with history: {result['markets_with_history']}")
    click.echo(f"  Range: {result['date_range']}")


if __name__ == "__main__":
    main()
