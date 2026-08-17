"""Export SQLite data to static JSON files for the Vercel dashboard."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import click

from db import Database
from scoring_contract import SCORING_VERSION, scoring_metadata

log = logging.getLogger(__name__)

SUB_CATEGORY_MAP = {
    # Crypto
    "price_above": "price_targets",
    "price_below": "price_targets",
    "price_range": "price_targets",
    "regulatory_positive": "regulatory",
    "regulatory_negative": "regulatory",
    "adoption": "adoption",
    "event_positive": "events",
    "event_negative": "events",
    # Stocks
    "earnings_positive": "earnings",
    "earnings_negative": "earnings",
    "corporate_positive": "corporate",
    "corporate_negative": "corporate",
    # Economy
    "monetary_dovish": "monetary_policy",
    "monetary_hawkish": "monetary_policy",
    "inflation_rising": "inflation",
    "inflation_falling": "inflation",
    "growth_positive": "growth",
    "growth_negative": "growth",
    "employment_positive": "employment",
    "employment_negative": "employment",
    # Politics
    "favors_incumbent": "favors_incumbent",
    "favors_challenger": "favors_challenger",
    "legislative_positive": "legislative",
    "legislative_negative": "legislative",
    "judicial_event": "judicial",
    "geopolitical_event": "geopolitical",
    "geopolitical_deescalation": "geopolitical",
}

SECTOR_CATEGORIES = {
    "crypto": ["price_targets", "regulatory", "adoption", "events", "other"],
    "stocks": ["price_targets", "earnings", "corporate", "other"],
    "economy": ["monetary_policy", "inflation", "growth", "employment", "other"],
    "politics": ["favors_incumbent", "favors_challenger", "legislative", "judicial", "geopolitical", "other"],
}

SECTOR_REF_KEYS = {
    "crypto": ["btc_price", "fear_greed"],
    "stocks": ["spx_price", "vix_price"],
    "economy": ["us10y_yield", "fed_rate", "unemployment"],
    "politics": [],
}

# Why: the served site is `public/` (see vercel.json outputDirectory), and both
# scripts/validate-data.js and the Daily Snapshot commit step read public/data/.
# This used to point at pipeline/dashboard/data/, so every CI export since the
# site moved to public/ wrote into a directory nobody reads — the published JSON
# froze at 2026-05-01 while the pipeline reported success. Resolve from the repo
# root, not the pipeline dir, and never make this relative to the process cwd
# (CI runs export.py from inside pipeline/).
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data"
MAX_MARKETS = 500

# Sandbox payload bounds. Per-market series are dense (one slot per asset date),
# so an uncapped export grows with markets x dates and reached 150 MB/sector —
# past GitHub's 100 MB file ceiling and far past a usable browser fetch.
SANDBOX_WINDOW_DAYS = 180
SANDBOX_MAX_MARKETS_PER_ASSET = 250


def _compute_sub_scores(markets: list[dict], sector: str) -> dict[str, dict]:
    """Compute sub-category scores from per-market snapshots."""
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for m in markets:
        cat = SUB_CATEGORY_MAP.get(m["classification"])
        if cat:
            by_cat[cat].append(m)

    sub: dict[str, dict] = {}
    for cat in [c for c in SECTOR_CATEGORIES.get(sector, []) if c != "other"]:
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
            # No coverage is not a neutral reading. Emitting 50.0 here made an
            # empty category indistinguishable from a measured dead-centre one.
            sub[cat] = {"score": None, "normalized": None, "market_count": 0}
    return sub


def _sub_score_counts(markets: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for m in markets:
        cat = SUB_CATEGORY_MAP.get(m["classification"])
        if cat:
            counts[cat] += 1
    return counts


def _format_stored_sub_scores(sector_row: dict, markets: list[dict], sector: str) -> dict[str, dict]:
    """Format canonical sector sub-scores saved by the scorer."""
    raw = sector_row.get("sub_scores_json")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = None

    if not isinstance(raw, dict):
        return _compute_sub_scores(markets, sector)

    counts = _sub_score_counts(markets)
    sub: dict[str, dict] = {}
    for cat in [c for c in SECTOR_CATEGORIES.get(sector, []) if c != "other"]:
        count = counts.get(cat, 0)
        try:
            score = float(raw.get(cat, 0.0) or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        if count == 0:
            # The stored score is computed over the whole snapshot while the count
            # comes from the exported markets; when they disagree the published
            # figure was a score attributed to no visible markets (regulatory read
            # 54.9 over 0 markets). Publish the absence instead.
            if score:
                log.warning("Sub-score %s/%s has score %.4f but 0 markets — publishing null",
                            sector, cat, score)
            sub[cat] = {"score": None, "normalized": None, "market_count": 0}
            continue
        sub[cat] = {
            "score": round(score, 4),
            "normalized": round((score + 1) * 50, 1),
            "market_count": count,
        }
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

    all_markets = db.get_market_snapshots(latest_date, sector=sector)
    # Find latest sector row
    sector_rows = db.get_sector_timeseries(sector, start=latest_date, end=latest_date)
    sector_row = sector_rows[0] if sector_rows else {}
    sub_scores = _format_stored_sub_scores(sector_row, all_markets, sector)
    by_asset = _compute_by_asset(all_markets)

    # Sort by weight desc and cap for per-market output
    markets_raw = sorted(all_markets, key=lambda m: m["weight"], reverse=True)[:MAX_MARKETS]

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


def _build_category_case_sql() -> str:
    """Build a SQL CASE expression mapping classification -> category."""
    return """
        CASE
            WHEN classification IN ('price_above','price_below','price_range') THEN 'price_targets'
            WHEN classification IN ('regulatory_positive','regulatory_negative') THEN 'regulatory'
            WHEN classification = 'adoption' THEN 'adoption'
            WHEN classification IN ('event_positive','event_negative') THEN 'events'
            WHEN classification IN ('earnings_positive','earnings_negative') THEN 'earnings'
            WHEN classification IN ('corporate_positive','corporate_negative') THEN 'corporate'
            WHEN classification IN ('monetary_dovish','monetary_hawkish') THEN 'monetary_policy'
            WHEN classification IN ('inflation_rising','inflation_falling') THEN 'inflation'
            WHEN classification IN ('growth_positive','growth_negative') THEN 'growth'
            WHEN classification IN ('employment_positive','employment_negative') THEN 'employment'
            WHEN classification = 'favors_incumbent' THEN 'favors_incumbent'
            WHEN classification = 'favors_challenger' THEN 'favors_challenger'
            WHEN classification IN ('legislative_positive','legislative_negative') THEN 'legislative'
            WHEN classification = 'judicial_event' THEN 'judicial'
            WHEN classification IN ('geopolitical_event', 'geopolitical_deescalation') THEN 'geopolitical'
            ELSE 'other'
        END
    """


def export_sandbox(
    db: Database,
    sector: str = "crypto",
    window_days: int = SANDBOX_WINDOW_DAYS,
    max_markets_per_asset: int = SANDBOX_MAX_MARKETS_PER_ASSET,
) -> dict:
    """Build sandbox.json — per-asset category timeseries for custom indicator sandbox.

    Bounded on both axes. `window_days` trims the snapshot history so the payload
    stops growing with the age of the project; `max_markets_per_asset` keeps the
    highest-volume markets per asset and drops the long tail. Both bounds are on
    the per-market series, which is what actually dominates the file — the
    category aggregates and reference prices are small.
    """
    ph = "%s" if db.is_postgres else "?"
    cat_case = _build_category_case_sql()

    # Category-level aggregates (existing behavior)
    # For non-crypto sectors, allow asset='OTHER' since many markets won't match
    # specific asset patterns (e.g. politics markets have no financial asset)
    sector_filter = f"AND sector = {ph}"
    # Exclude crypto tickers from non-crypto sectors (historical misclassification)
    _CRYPTO_TICKERS = ('BTC','ETH','SOL','XRP','ADA','DOGE','AVAX','DOT','LINK','MATIC','UNI','LTC','ATOM','NEAR','SUI')
    crypto_exclude = ""
    if sector != "crypto":
        placeholders = ",".join([ph] * len(_CRYPTO_TICKERS))
        crypto_exclude = f"AND asset NOT IN ({placeholders})"
    if sector == "crypto":
        base_filter = f"WHERE asset != 'OTHER' {sector_filter}"
    else:
        base_filter = f"WHERE 1=1 {sector_filter} {crypto_exclude}"
    params = [sector]
    if sector != "crypto":
        params.extend(_CRYPTO_TICKERS)

    # Rolling window on snapshot history. Applied in SQL so the rows never leave
    # the database, and to every query below so the aggregates and the per-market
    # series describe the same date range.
    window_start: str | None = None
    if window_days and window_days > 0:
        window_start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
        base_filter = f"{base_filter} AND date >= {ph}"
        params.append(window_start)

    rows = db._select(f"""
        SELECT date, asset,
            {cat_case} as cat,
            SUM(sentiment_signal * weight) as ws,
            SUM(weight) as wt,
            COUNT(*) as n
        FROM market_snapshots
        {base_filter}
        GROUP BY date, asset, cat
        ORDER BY date, asset, cat
    """, params)

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

    # Per-market timeseries (for market-mode indicators)
    market_rows = db._select(f"""
        SELECT date, market_id, question, asset,
            {cat_case} as cat,
            sentiment_signal, weight, probability, volume_24h, end_date
        FROM market_snapshots
        {base_filter}
        ORDER BY date, market_id
    """, params)

    # Build per-market timeseries: { asset: { market_id: { q, cat, ss[], wt[], end, prob, vol } } }
    market_data: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {
        "q": "", "cat": "", "ss": [], "wt": [], "_dates": [], "end": None, "prob": None, "vol": 0,
    }))
    for r in market_rows:
        asset = r["asset"]
        mid = r["market_id"]
        md = market_data[asset][mid]
        md["q"] = r["question"]
        md["cat"] = r["cat"]
        md["ss"].append(round(r["sentiment_signal"], 6) if r["sentiment_signal"] is not None else None)
        md["wt"].append(round(r["weight"], 6) if r["weight"] is not None else None)
        md["_dates"].append(r["date"])
        # Keep latest probability, volume, end_date
        if r.get("probability") is not None:
            md["prob"] = round(float(r["probability"]), 4)
        if r.get("volume_24h") is not None:
            md["vol"] = round(float(r["volume_24h"]), 0)
        if r.get("end_date"):
            md["end"] = r["end_date"][:10] if r["end_date"] else None  # YYYY-MM-DD

    # Only assets with enough data points. Non-crypto sectors used to qualify on a
    # single date, which published assets whose whole "series" was one snapshot —
    # a flat line the sandbox will happily correlate against anything. Same floor
    # for every sector now.
    min_dates = 5
    qualified = {a for a, ds in asset_date_sets.items() if len(ds) >= min_dates}

    # Reference prices (full date range) — include ALL columns so any "Test Against" works
    ref_prices = db.get_reference_prices()
    ref_dates = sorted(ref_prices.keys())
    all_ref_keys = [
        "btc_price", "fear_greed", "eth_price", "sol_price",
        "spx_price", "ndx_price", "dji_price", "rut_price", "vix_price",
        "us10y_yield", "us2y_yield", "dxy_price", "fed_rate", "unemployment",
        "gold_price", "oil_price",
    ]
    ref: dict = {"dates": ref_dates}
    for key in all_ref_keys:
        vals = [ref_prices[d].get(key) for d in ref_dates]
        if any(v is not None for v in vals):
            ref[key] = vals

    # Build columnar arrays per asset
    cats = SECTOR_CATEGORIES.get(sector, SECTOR_CATEGORIES["crypto"])
    assets_out = {}
    dropped_markets: dict[str, int] = {}
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

        # Per-market data aligned to asset dates. Keep the highest-volume markets
        # first: an asset like OTHER collects thousands of markets, each carrying a
        # dense array one slot per asset date, and the tail is both the bulk of the
        # bytes and the least informative part of the signal.
        markets_out = {}
        date_idx = {d: i for i, d in enumerate(dates)}
        asset_markets = market_data.get(asset, {})
        if max_markets_per_asset and len(asset_markets) > max_markets_per_asset:
            ranked = sorted(
                asset_markets.items(),
                key=lambda kv: (kv[1].get("vol") or 0, len(kv[1]["_dates"])),
                reverse=True,
            )
            dropped_markets[asset] = len(asset_markets) - max_markets_per_asset
            asset_markets = dict(ranked[:max_markets_per_asset])
        for mid, md in asset_markets.items():
            # Build aligned arrays
            ss_aligned = [None] * len(dates)
            wt_aligned = [None] * len(dates)
            for j, d in enumerate(md["_dates"]):
                idx = date_idx.get(d)
                if idx is not None:
                    ss_aligned[idx] = md["ss"][j]
                    wt_aligned[idx] = md["wt"][j]
            # Only include markets with at least some data
            if any(s is not None for s in ss_aligned):
                entry = {"q": md["q"], "cat": md["cat"], "ss": ss_aligned, "wt": wt_aligned}
                if md["end"]:
                    entry["end"] = md["end"]
                if md["prob"] is not None:
                    entry["prob"] = md["prob"]
                if md["vol"]:
                    entry["vol"] = md["vol"]
                markets_out[mid] = entry

        assets_out[asset] = {"dates": dates, "cats": cat_arrays, "markets": markets_out}

    ref_included = [k for k in ref if k != 'dates']
    log.info("Sandbox[%s]: %d qualified assets, %d ref dates, ref_keys=%s",
             sector, len(qualified), len(ref_dates), ref_included)
    # Say out loud what was left out — a cap that reports nothing reads as full coverage.
    log.info("Sandbox[%s]: window=%s (%s days), max %d markets/asset, dropped tail: %s",
             sector, window_start or "all history", window_days or "unbounded",
             max_markets_per_asset,
             ", ".join(f"{a}:{n}" for a, n in sorted(dropped_markets.items())) or "none")
    return {
        "ref": ref,
        "assets": assets_out,
        "bounds": {
            "window_days": window_days,
            "window_start": window_start,
            "max_markets_per_asset": max_markets_per_asset,
            "dropped_markets": dropped_markets,
            "min_dates": min_dates,
        },
    }


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=_json_default)
    tmp.replace(path)
    size_kb = path.stat().st_size / 1024
    log.info("Wrote %s (%.1f KB)", path.name, size_kb)


def _read_existing_meta(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _safe_json_obj(value) -> dict:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value if isinstance(value, dict) else {}


def build_export_meta(
    *,
    output: Path,
    db: Database,
    sector: str,
    latest_data: dict,
    sandbox_data: dict,
    generated_at: str,
    latest_name: str,
    sandbox_name: str,
) -> dict:
    """Merge this export into the public production metadata file."""
    meta = _read_existing_meta(output / "meta.json")
    meta.update(scoring_metadata())
    meta["generated_at"] = generated_at
    meta["data_source"] = "Polymarket Gamma & CLOB APIs plus reference market data feeds"
    meta["update_frequency"] = "Daily scheduled pipeline"
    sectors = meta.get("sectors") if isinstance(meta.get("sectors"), dict) else {}
    sectors[sector] = {
        "status": "ok" if latest_data.get("date") else "empty",
        "latest_date": latest_data.get("date"),
        "generated_at": generated_at,
        "scoring_version": SCORING_VERSION,
        "market_count": latest_data.get("market_count", 0),
        "sandbox_assets": len(sandbox_data.get("assets", {})),
        "files": {
            "latest": f"data/{latest_name}",
            "sandbox": f"data/{sandbox_name}",
        },
    }
    meta["sectors"] = sectors

    runs = []
    try:
        for row in db.get_pipeline_status(limit=12):
            item = dict(row)
            item["summary"] = _safe_json_obj(item.pop("summary_json", None))
            runs.append(item)
    except Exception as exc:
        log.debug("Pipeline run metadata unavailable: %s", exc)
    if runs:
        meta["pipeline_runs"] = runs

    return meta


@click.command()
@click.option("--db", "db_path", default=None, help="Database path")
@click.option("--out", "out_dir", default=None, help="Output directory")
@click.option("--sector", default="crypto", help="Sector to export (default: crypto)")
@click.option("--sandbox-days", default=SANDBOX_WINDOW_DAYS, show_default=True,
              help="Rolling window of snapshot history in the sandbox export (0 = all history)")
@click.option("--sandbox-max-markets", default=SANDBOX_MAX_MARKETS_PER_ASSET, show_default=True,
              help="Keep at most this many markets per asset, highest volume first (0 = all)")
@click.option("-v", "--verbose", is_flag=True)
def main(db_path: str | None, out_dir: str | None, sector: str,
         sandbox_days: int, sandbox_max_markets: int, verbose: bool):
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

        log.info("Exporting sandbox data for sector '%s'...", sector)
        sandbox_data = export_sandbox(
            db,
            sector=sector,
            window_days=sandbox_days,
            max_markets_per_asset=sandbox_max_markets,
        )

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
    meta = build_export_meta(
        output=output,
        db=db,
        sector=sector,
        latest_data=latest_data,
        sandbox_data=sandbox_data,
        generated_at=now,
        latest_name=latest_name,
        sandbox_name=sandbox_name,
    )
    _write_json(output / "meta.json", meta)

    click.echo(f"\nExported to {output}/")
    click.echo(f"  {latest_name} — {latest_data.get('date', '?')}, {len(latest_data.get('markets', []))} markets")
    click.echo(f"  {sandbox_name} — {len(sandbox_data.get('assets', {}))} assets")


if __name__ == "__main__":
    main()
