"""Export SQLite data to static JSON files for the Vercel dashboard."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import click

from db import Database

log = logging.getLogger(__name__)

SUB_CATEGORY_MAP = {
    "price_above": "price_targets",
    "price_below": "price_targets",
    "price_range": "price_targets",
    "regulatory_positive": "regulatory",
    "regulatory_negative": "regulatory",
    "adoption": "adoption",
    "event_positive": "events",
    "event_negative": "events",
}

CATEGORY_ORDER = ["price_targets", "regulatory", "adoption", "events"]

OUTPUT_DIR = Path(__file__).parent / "dashboard" / "data"
MAX_MARKETS = 500


def _compute_sub_scores(markets: list[dict]) -> dict[str, dict]:
    """Compute sub-category scores from per-market snapshots."""
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for m in markets:
        cat = SUB_CATEGORY_MAP.get(m["classification"])
        if cat:
            by_cat[cat].append(m)

    sub: dict[str, dict] = {}
    for cat in CATEGORY_ORDER:
        ms = by_cat.get(cat, [])
        if ms:
            w_sum = sum(m["sentiment_signal"] * m["weight"] for m in ms)
            t_w = sum(m["weight"] for m in ms)
            raw = w_sum / t_w if t_w > 0 else 0.0
            sub[cat] = {
                "score": round(raw, 4),
                "normalized": round((raw + 1) * 50, 1),
                "market_count": len(ms),
            }
        else:
            sub[cat] = {"score": 0.0, "normalized": 50.0, "market_count": 0}
    return sub


def _compute_by_asset(markets: list[dict]) -> dict[str, dict]:
    """Compute per-asset sentiment breakdown."""
    by_asset: dict[str, list[dict]] = defaultdict(list)
    for m in markets:
        asset = m.get("asset") or "OTHER"
        by_asset[asset].append(m)

    result = {}
    for asset, ms in sorted(by_asset.items(), key=lambda x: -len(x[1])):
        w_sum = sum(m["sentiment_signal"] * m["weight"] for m in ms)
        t_w = sum(m["weight"] for m in ms)
        raw = w_sum / t_w if t_w > 0 else 0.0
        result[asset] = {
            "score": round((raw + 1) * 50, 1),
            "market_count": len(ms),
            "volume_24h": round(sum(m["volume_24h"] for m in ms), 0),
        }
    return result


def export_latest(db: Database, sector: str) -> dict:
    """Build latest.json data with asset and horizon breakdowns."""
    latest_date = db.get_latest_date(sector)
    if not latest_date:
        return {}

    all_markets = db.get_market_snapshots(latest_date)
    sub_scores = _compute_sub_scores(all_markets)
    by_asset = _compute_by_asset(all_markets)

    # Sort by weight desc and cap for per-market output
    markets_raw = sorted(all_markets, key=lambda m: m["weight"], reverse=True)[:MAX_MARKETS]

    # Find latest sector row
    sector_rows = db.get_sector_timeseries(sector, start=latest_date, end=latest_date)
    sector_row = sector_rows[0] if sector_rows else {}

    # Reference price for today
    ref_prices = db.get_reference_prices(start=latest_date, end=latest_date)
    ref = ref_prices.get(latest_date, {})

    # Format markets for frontend
    markets_out = []
    for m in markets_raw:
        cat = SUB_CATEGORY_MAP.get(m["classification"], "unclassified")
        entry = {
            "id": m["market_id"],
            "event_id": m.get("event_id") or m["market_id"],
            "question": m["question"],
            "classification": m["classification"],
            "category": cat,
            "polarity": m["polarity"],
            "probability": round(m["probability"], 4),
            "signal": round(m["sentiment_signal"], 4),
            "weight": round(m["weight"], 4),
            "volume_24h": round(m["volume_24h"], 0),
            "open_interest": round(m["open_interest"], 0),
            "asset": m.get("asset") or "OTHER",
        }
        markets_out.append(entry)

    result = {
        "date": latest_date,
        "composite": round(sector_row.get("composite", 0), 4),
        "normalized": round(sector_row.get("composite_normalized", 50), 1),
        "market_count": sector_row.get("market_count", 0),
        "volume_24h": round(sector_row.get("total_volume_24h", 0), 0),
        "open_interest": round(sector_row.get("total_open_interest", 0), 0),
        "avg_liquidity": round(sector_row.get("avg_liquidity", 0), 0),
        "bullish_pct": round(sector_row.get("bullish_pct", 0), 1),
        "sub_scores": sub_scores,
        "by_asset": by_asset,
        "markets": markets_out,
    }
    if ref.get("btc_price") is not None:
        result["btc_price"] = ref["btc_price"]
    if ref.get("fear_greed") is not None:
        result["fear_greed"] = ref["fear_greed"]

    return result


def export_sandbox(db: Database) -> dict:
    """Build sandbox.json — per-asset category timeseries for custom indicator sandbox."""
    rows = db._select("""
        SELECT date, asset,
            CASE
                WHEN classification IN ('price_above','price_below','price_range') THEN 'price_targets'
                WHEN classification IN ('regulatory_positive','regulatory_negative') THEN 'regulatory'
                WHEN classification = 'adoption' THEN 'adoption'
                WHEN classification IN ('event_positive','event_negative') THEN 'events'
                ELSE 'other'
            END as cat,
            SUM(sentiment_signal * weight) as ws,
            SUM(weight) as wt,
            COUNT(*) as n
        FROM market_snapshots
        WHERE asset != 'OTHER'
        GROUP BY date, asset, cat
        ORDER BY date, asset, cat
    """)

    # Build lookup: (asset, date, cat) -> {ws, wt, n}
    asset_date_sets: dict[str, set] = defaultdict(set)
    agg: dict[tuple, dict] = {}
    for row in rows:
        asset, d, cat = row["asset"], row["date"], row["cat"]
        asset_date_sets[asset].add(d)
        agg[(asset, d, cat)] = {
            "ws": round(row["ws"], 6),
            "wt": round(row["wt"], 6),
            "n": row["n"],
        }

    # Only assets with >= 5 data points
    qualified = {a for a, ds in asset_date_sets.items() if len(ds) >= 5}

    # Reference prices (full date range)
    ref_prices = db.get_reference_prices()
    ref_dates = sorted(ref_prices.keys())
    ref = {
        "dates": ref_dates,
        "btc_price": [ref_prices[d].get("btc_price") for d in ref_dates],
        "fear_greed": [ref_prices[d].get("fear_greed") for d in ref_dates],
    }

    # Build columnar arrays per asset
    cats = ["price_targets", "regulatory", "adoption", "events", "other"]
    assets_out = {}
    for asset in sorted(qualified):
        dates = sorted(asset_date_sets[asset])
        cat_arrays = {}
        for cat in cats:
            ws, wt, n = [], [], []
            for d in dates:
                cd = agg.get((asset, d, cat), {})
                ws.append(round(cd.get("ws", 0), 6))
                wt.append(round(cd.get("wt", 0), 6))
                n.append(cd.get("n", 0))
            cat_arrays[cat] = {"ws": ws, "wt": wt, "n": n}
        assets_out[asset] = {"dates": dates, "cats": cat_arrays}

    log.info("Sandbox: %d qualified assets, %d ref dates", len(qualified), len(ref_dates))
    return {"ref": ref, "assets": assets_out}


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    size_kb = path.stat().st_size / 1024
    log.info("Wrote %s (%.1f KB)", path.name, size_kb)


@click.command()
@click.option("--db", "db_path", default=None, help="Database path")
@click.option("--out", "out_dir", default=None, help="Output directory")
@click.option("--sector", default="crypto", help="Sector to export (default: crypto)")
@click.option("-v", "--verbose", is_flag=True)
def main(db_path: str | None, out_dir: str | None, sector: str, verbose: bool):
    """Export sentiment data to static JSON for the dashboard."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        datefmt="%H:%M:%S",
    )

    output = Path(out_dir) if out_dir else OUTPUT_DIR
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    db = Database(db_path)
    with db:
        log.info("Exporting latest snapshot for sector '%s'...", sector)
        latest_data = export_latest(db, sector)

        log.info("Exporting sandbox data...")
        sandbox_data = export_sandbox(db)

    # Add generation timestamp
    latest_data["generated_at"] = now
    sandbox_data["generated_at"] = now

    # Filenames: crypto uses original names, other sectors get suffixed
    if sector == "crypto":
        latest_name = "latest.json"
        sandbox_name = "sandbox.json"
    else:
        latest_name = f"latest-{sector}.json"
        sandbox_name = f"sandbox-{sector}.json"

    _write_json(output / latest_name, latest_data)
    _write_json(output / sandbox_name, sandbox_data)

    click.echo(f"\nExported to {output}/")
    click.echo(f"  {latest_name} — {latest_data.get('date', '?')}, {len(latest_data.get('markets', []))} markets")
    click.echo(f"  {sandbox_name} — {len(sandbox_data.get('assets', {}))} assets")


if __name__ == "__main__":
    main()
