"""Historical backfill using /prices-history to reconstruct past sentiment scores."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, timezone

import click

from classifier import classify_batch
from collector import Collector, PricePoint
from config import BACKFILL_FIDELITY, BACKFILL_INTERVAL
from db import Database
from discovery import Discoverer, Market
from scorer import MarketScore, SectorScore, market_weight

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
        signal = (prob - 0.5) * 2
    elif polarity == "bearish":
        signal = (0.5 - prob) * 2
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
            weighted_sum = 0.0
            total_weight = 0.0

            for market_id, price in market_prices:
                market = markets_by_id.get(market_id)
                cls = classifications.get(market_id)
                if not market or not cls:
                    continue

                weight = market_weight(market)
                ms = _score_from_price(market, price, cls.polarity, cls.signal_type, weight,
                                       asset=getattr(cls, "asset", "OTHER"))
                market_scores.append(ms)
                weighted_sum += ms.sentiment_signal * ms.weight
                total_weight += ms.weight

            if not market_scores:
                continue

            composite = weighted_sum / total_weight if total_weight > 0 else 0.0
            composite = max(-1.0, min(1.0, composite))

            bullish_count = sum(1 for ms in market_scores if ms.sentiment_signal > 0.1)
            volumes = [ms.volume_24h for ms in market_scores if ms.volume_24h > 0]
            liquidities = [ms.liquidity for ms in market_scores if ms.liquidity > 0]
            from statistics import mean as _mean
            total = sum(volumes)
            hhi = sum((v / total) ** 2 for v in volumes) if total > 0 else 0.0

            score = SectorScore(
                composite=composite,
                composite_normalized=(composite + 1) * 50,
                market_count=len(market_scores),
                total_volume_24h=sum(ms.volume_24h for ms in market_scores),
                total_open_interest=sum(ms.open_interest for ms in market_scores),
                avg_liquidity=_mean(liquidities) if liquidities else 0.0,
                bullish_pct=(bullish_count / len(market_scores) * 100),
                volume_concentration=hhi,
                sub_scores={},
                market_scores=market_scores,
            )
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
