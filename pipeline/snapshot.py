"""Daily snapshot orchestrator — cron entrypoint."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

import click

from classifier import classify_batch, classify_batch_with_llm
from collector import Collector
from db import Database
from discovery import Discoverer
from prices import update_reference_prices
from scorer import sector_sentiment

log = logging.getLogger(__name__)


async def run_snapshot(
    sector: str = "crypto",
    *,
    use_llm: bool = False,
    skip_order_books: bool = False,
    db_path: str | None = None,
    snapshot_date: date | None = None,
) -> dict:
    """Execute the full snapshot pipeline for a sector.

    Returns a summary dict with key metrics.
    """
    snapshot_date = snapshot_date or date.today()
    log.info("Starting snapshot for sector=%s date=%s", sector, snapshot_date)

    # 1. Discover markets
    log.info("Step 1/5: Discovering markets...")
    discoverer = Discoverer(sector)
    events = await discoverer.discover(active_only=True)
    all_markets = [m for e in events for m in e.markets]
    log.info("Found %d events, %d markets", len(events), len(all_markets))

    if not all_markets:
        log.warning("No markets found — aborting snapshot")
        return {"error": "no_markets", "market_count": 0}

    # 2. Classify markets
    log.info("Step 2/5: Classifying markets...")
    classifications = classify_batch(all_markets, sector=sector)

    if use_llm:
        classifications = await classify_batch_with_llm(all_markets, classifications)

    # 3. Collect order book data
    order_books = {}
    if not skip_order_books:
        log.info("Step 3/5: Collecting order books...")
        collector = Collector()
        order_books = await collector.collect_order_books(all_markets)
    else:
        log.info("Step 3/5: Skipping order books (--skip-order-books)")

    # 4. Compute scores
    log.info("Step 4/5: Computing scores...")
    now = datetime.now(timezone.utc)
    score = sector_sentiment(all_markets, classifications, order_books, now)

    # 5. Persist to database
    log.info("Step 5/6: Saving to database...")
    db = Database(db_path)
    with db:
        db.save_snapshot(snapshot_date, sector, score)
        db.save_classifications(classifications)

        # 6. Fetch reference prices (sector-appropriate feeds)
        log.info("Step 6/6: Updating reference prices for sector '%s'...", sector)
        try:
            await update_reference_prices(db, sector=sector, days=365)
        except Exception as e:
            log.warning("Reference price update failed (non-fatal): %s", e)

    summary = {
        "date": str(snapshot_date),
        "sector": sector,
        "composite": round(score.composite, 4),
        "composite_normalized": round(score.composite_normalized, 1),
        "market_count": score.market_count,
        "total_volume_24h": round(score.total_volume_24h, 2),
        "total_open_interest": round(score.total_open_interest, 2),
        "bullish_pct": round(score.bullish_pct, 1),
        "sub_scores": {k: round(v, 4) for k, v in score.sub_scores.items()},
    }
    log.info("Snapshot complete: %s", summary)
    return summary


@click.command()
@click.option("--sector", default="crypto", help="Sector to score")
@click.option("--llm", is_flag=True, help="Use LLM for unclassified markets")
@click.option("--skip-order-books", is_flag=True, help="Skip order book collection")
@click.option("--db", "db_path", default=None, help="Database path")
@click.option("--date", "date_str", default=None, help="Override snapshot date (YYYY-MM-DD)")
@click.option("-v", "--verbose", is_flag=True, help="Verbose logging")
def main(sector: str, llm: bool, skip_order_books: bool, db_path: str | None, date_str: str | None, verbose: bool):
    """Run a daily sentiment snapshot."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    snapshot_date = date.fromisoformat(date_str) if date_str else None

    result = asyncio.run(run_snapshot(
        sector,
        use_llm=llm,
        skip_order_books=skip_order_books,
        db_path=db_path,
        snapshot_date=snapshot_date,
    ))

    if "error" in result:
        click.echo(f"Snapshot failed: {result['error']}")
        raise SystemExit(1)

    click.echo(f"\nSector: {result['sector']}")
    click.echo(f"Date:   {result['date']}")
    click.echo(f"Score:  {result['composite_normalized']:.1f}/100 (raw: {result['composite']:.4f})")
    click.echo(f"Markets: {result['market_count']} ({result['bullish_pct']:.0f}% bullish)")
    click.echo(f"Volume 24h: ${result['total_volume_24h']:,.0f}")
    click.echo(f"Open Interest: ${result['total_open_interest']:,.0f}")
    if result.get("sub_scores"):
        click.echo("Sub-scores:")
        for k, v in result["sub_scores"].items():
            click.echo(f"  {k}: {(v + 1) * 50:.1f}/100")


if __name__ == "__main__":
    main()
