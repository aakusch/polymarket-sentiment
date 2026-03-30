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


def _compute_by_horizon(markets: list[dict], snapshot_date: str) -> dict[str, dict]:
    """Compute sentiment by time horizon bucket."""
    from datetime import date as _date

    try:
        snap = _date.fromisoformat(snapshot_date)
    except (ValueError, TypeError):
        return {}

    buckets = {"1w": [], "1m": [], "3m": [], "6m+": []}

    for m in markets:
        end = m.get("end_date") or m.get("end_date_str")
        if not end:
            buckets["6m+"].append(m)
            continue
        try:
            end_str = end[:10] if len(end) >= 10 else end
            end_dt = _date.fromisoformat(end_str)
            days = (end_dt - snap).days
            if days < 7:
                buckets["1w"].append(m)
            elif days < 30:
                buckets["1m"].append(m)
            elif days < 90:
                buckets["3m"].append(m)
            else:
                buckets["6m+"].append(m)
        except (ValueError, TypeError):
            buckets["6m+"].append(m)

    result = {}
    for bucket, ms in buckets.items():
        if ms:
            w_sum = sum(m["sentiment_signal"] * m["weight"] for m in ms)
            t_w = sum(m["weight"] for m in ms)
            raw = w_sum / t_w if t_w > 0 else 0.0
            result[bucket] = {
                "score": round((raw + 1) * 50, 1),
                "market_count": len(ms),
            }
        else:
            result[bucket] = {"score": 50.0, "market_count": 0}
    return result


def export_timeseries(db: Database) -> list[dict]:
    """Build timeseries.json data with BTC price and Fear & Greed overlay."""
    rows = db.get_sector_timeseries("crypto")
    ref_prices = db.get_reference_prices()
    result = []

    for row in rows:
        date_markets = db.get_market_snapshots(row["date"])
        sub = _compute_sub_scores(date_markets)
        sub_flat = {cat: v["normalized"] for cat, v in sub.items()}
        ref = ref_prices.get(row["date"], {})

        entry = {
            "date": row["date"],
            "composite": round(row["composite"], 4),
            "normalized": round(row["composite_normalized"], 1),
            "market_count": row["market_count"],
            "volume_24h": round(row["total_volume_24h"], 0),
            "open_interest": round(row["total_open_interest"], 0),
            "bullish_pct": round(row["bullish_pct"], 1),
            "sub_scores": sub_flat,
        }
        if ref.get("btc_price") is not None:
            entry["btc_price"] = ref["btc_price"]
        if ref.get("fear_greed") is not None:
            entry["fear_greed"] = ref["fear_greed"]

        result.append(entry)

    return result


def export_latest(db: Database, timeseries: list[dict]) -> dict:
    """Build latest.json data with asset and horizon breakdowns."""
    latest_date = db.get_latest_date("crypto")
    if not latest_date:
        return {}

    all_markets = db.get_market_snapshots(latest_date)
    sub_scores = _compute_sub_scores(all_markets)
    by_asset = _compute_by_asset(all_markets)
    by_horizon = _compute_by_horizon(all_markets, latest_date)

    # Sort by weight desc and cap for per-market output
    markets_raw = sorted(all_markets, key=lambda m: m["weight"], reverse=True)[:MAX_MARKETS]

    # Find latest sector row
    sector_rows = db.get_sector_timeseries("crypto", start=latest_date, end=latest_date)
    sector = sector_rows[0] if sector_rows else {}

    # Reference price for today
    ref_prices = db.get_reference_prices(start=latest_date, end=latest_date)
    ref = ref_prices.get(latest_date, {})

    # Day-over-day delta
    delta = {}
    if len(timeseries) >= 2:
        prev = timeseries[-2]
        curr = timeseries[-1]
        delta = {
            "composite": round(curr["normalized"] - prev["normalized"], 1),
            "market_count": curr["market_count"] - prev["market_count"],
            "volume_24h": round(curr["volume_24h"] - prev["volume_24h"], 0),
        }

    # Format markets for frontend
    markets_out = []
    for m in markets_raw:
        cat = SUB_CATEGORY_MAP.get(m["classification"], "unclassified")
        entry = {
            "id": m["market_id"],
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
        "composite": round(sector.get("composite", 0), 4),
        "normalized": round(sector.get("composite_normalized", 50), 1),
        "market_count": sector.get("market_count", 0),
        "volume_24h": round(sector.get("total_volume_24h", 0), 0),
        "open_interest": round(sector.get("total_open_interest", 0), 0),
        "avg_liquidity": round(sector.get("avg_liquidity", 0), 0),
        "bullish_pct": round(sector.get("bullish_pct", 0), 1),
        "delta": delta,
        "sub_scores": sub_scores,
        "by_asset": by_asset,
        "by_horizon": by_horizon,
        "markets": markets_out,
    }
    if ref.get("btc_price") is not None:
        result["btc_price"] = ref["btc_price"]
    if ref.get("fear_greed") is not None:
        result["fear_greed"] = ref["fear_greed"]

    return result


def export_meta() -> dict:
    """Build meta.json — static methodology reference."""
    return {
        "sector": "crypto",
        "version": "2.0",
        "methodology": {
            "signal": {
                "formula": "(probability - 0.5) x 2",
                "description": "Each market's YES price maps to a directional signal from -1 (max bearish) to +1 (max bullish). For bearish-polarity markets (e.g. 'Will BTC crash?'), the signal is inverted. Neutral-polarity markets (e.g. price ranges) contribute weight but signal=0.",
            },
            "weight": {
                "formula": "0.4 x log(volume) + 0.3 x log(liquidity) + 0.2 x log(OI) + 0.1 x time_decay",
                "description": "Markets with more trading activity, deeper order books, and longer time horizons get more influence on the composite score.",
                "params": {
                    "volume_ceiling": "$50M",
                    "liquidity_ceiling": "$10M",
                    "oi_ceiling": "$20M",
                    "time_decay_horizon": "90 days",
                },
            },
            "composite": {
                "formula": "SUM(signal_i x weight_i) / SUM(weight_i)",
                "description": "The composite score is a weighted average of all individual market signals, normalized to a 0-100 scale where 50 is neutral.",
            },
            "categories": {
                "price_targets": {
                    "types": ["price_above", "price_below", "price_range"],
                    "description": "Markets asking whether crypto prices will reach specific levels",
                },
                "regulatory": {
                    "types": ["regulatory_positive", "regulatory_negative"],
                    "description": "Markets about government regulation, legislation, and enforcement",
                },
                "adoption": {
                    "types": ["adoption"],
                    "description": "Markets about user growth, partnerships, and ecosystem milestones",
                },
                "events": {
                    "types": ["event_positive", "event_negative"],
                    "description": "Markets about specific events like ETF approvals, hacks, or upgrades",
                },
            },
            "noise_filtering": {
                "description": "Short-duration binary option markets (e.g. 5-minute 'Up or Down' bets) are excluded from scoring. These are coin-flip markets that dilute the composite signal.",
                "criteria": "Events matching 'Up or Down' title pattern with duration < 24 hours",
            },
            "asset_classification": {
                "description": "Markets are tagged with the primary asset (BTC, ETH, SOL, etc.) using regex pattern matching on the market question. Unmatched markets are tagged 'OTHER'.",
                "supported_assets": ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "MATIC", "UNI", "LTC", "ATOM", "NEAR", "SUI"],
            },
            "reference_data": {
                "btc_price": "Daily BTC/USD from CoinGecko (free, no auth)",
                "fear_greed": "Crypto Fear & Greed Index from Alternative.me (0-100 scale)",
            },
            "data_source": "Polymarket Gamma & CLOB APIs (fully public, no auth required)",
            "update_frequency": "Daily",
        },
    }


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    size_kb = path.stat().st_size / 1024
    log.info("Wrote %s (%.1f KB)", path.name, size_kb)


@click.command()
@click.option("--db", "db_path", default=None, help="Database path")
@click.option("--out", "out_dir", default=None, help="Output directory")
@click.option("-v", "--verbose", is_flag=True)
def main(db_path: str | None, out_dir: str | None, verbose: bool):
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
        log.info("Exporting timeseries...")
        ts_data = export_timeseries(db)

        log.info("Exporting latest snapshot...")
        latest_data = export_latest(db, ts_data)

    log.info("Exporting metadata...")
    meta_data = export_meta()

    # Add generation timestamp
    ts_out = {"sector": "crypto", "generated_at": now, "data": ts_data}
    latest_data["generated_at"] = now
    meta_data["generated_at"] = now

    _write_json(output / "timeseries.json", ts_out)
    _write_json(output / "latest.json", latest_data)
    _write_json(output / "meta.json", meta_data)

    click.echo(f"\nExported to {output}/")
    click.echo(f"  timeseries.json — {len(ts_data)} dates")
    click.echo(f"  latest.json — {latest_data.get('date', '?')}, {len(latest_data.get('markets', []))} markets")
    click.echo(f"  meta.json — methodology reference v2.0")


if __name__ == "__main__":
    main()
