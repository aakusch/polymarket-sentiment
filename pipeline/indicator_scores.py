"""Shared indicator score helpers for pipeline jobs."""

from __future__ import annotations

import json
from collections.abc import Mapping


SECTOR_CATEGORIES = {
    "crypto": ["price_targets", "regulatory", "adoption", "events"],
    "politics": ["favors_incumbent", "favors_challenger", "legislative", "judicial", "geopolitical"],
    "stocks": ["price_targets", "earnings", "corporate"],
    "economy": ["monetary_policy", "inflation", "growth", "employment"],
}


CATEGORY_CASE_SQL = """
    CASE
        WHEN classification IN ('price_above','price_below','price_range') THEN 'price_targets'
        WHEN classification IN ('regulatory_positive','regulatory_negative') THEN 'regulatory'
        WHEN classification = 'adoption' THEN 'adoption'
        WHEN classification IN ('event_positive','event_negative') THEN 'events'
        WHEN classification = 'favors_incumbent' THEN 'favors_incumbent'
        WHEN classification = 'favors_challenger' THEN 'favors_challenger'
        WHEN classification IN ('legislative_positive','legislative_negative') THEN 'legislative'
        WHEN classification = 'judicial_event' THEN 'judicial'
        WHEN classification = 'geopolitical_event' THEN 'geopolitical'
        WHEN classification IN ('earnings_positive','earnings_negative') THEN 'earnings'
        WHEN classification IN ('corporate_positive','corporate_negative') THEN 'corporate'
        WHEN classification IN ('monetary_dovish','monetary_hawkish') THEN 'monetary_policy'
        WHEN classification IN ('inflation_rising','inflation_falling') THEN 'inflation'
        WHEN classification IN ('growth_positive','growth_negative') THEN 'growth'
        WHEN classification IN ('employment_positive','employment_negative') THEN 'employment'
        ELSE 'other'
    END
"""


def _json_obj(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def _market_config(indicator: dict) -> dict | None:
    markets = _json_obj(indicator.get("markets"))
    if markets:
        return markets
    weights = _json_obj(indicator.get("weights"))
    nested = weights.get("markets")
    if isinstance(nested, Mapping) and nested:
        return dict(nested)
    return None


def _category_weights(indicator: dict) -> dict:
    weights = _json_obj(indicator.get("weights"))
    if isinstance(weights.get("markets"), Mapping):
        return {}
    return weights


def _weight_and_flip(value) -> tuple[float, bool]:
    if isinstance(value, (int, float)):
        return float(value), False
    if isinstance(value, str):
        try:
            return float(value), False
        except ValueError:
            return 100.0, False
    if isinstance(value, Mapping):
        raw = value.get("w", value.get("weight", 100))
        try:
            weight = float(raw)
        except (TypeError, ValueError):
            weight = 100.0
        return weight, bool(value.get("flip"))
    return 100.0, False


def _has_explicit_sector(markets: dict) -> bool:
    return any(isinstance(v, Mapping) and v.get("sector") for v in markets.values())


def _fear_greed_for_date(conn, snapshot_date: str) -> float | None:
    cur = conn.cursor()
    cur.execute("SELECT fear_greed FROM reference_prices WHERE date = %s", (snapshot_date,))
    row = cur.fetchone()
    if not row or row[0] is None:
        return None
    return float(row[0])


def fetch_public_indicators(conn, indicator_ids: list[str] | None = None) -> list[dict]:
    """Fetch public indicators using the canonical app config columns."""
    cur = conn.cursor()
    where = "WHERE is_public = true"
    params: list = []
    if indicator_ids:
        placeholders = ",".join(["%s"] * len(indicator_ids))
        where += f" AND id IN ({placeholders})"
        params.extend(indicator_ids)
    cur.execute(
        f"""
        SELECT id, sector, asset, markets, weights, fg_enabled, fg_weight, include_other
        FROM indicators
        {where}
        """,
        params,
    )
    rows = cur.fetchall()
    return [
        {
            "id": r[0],
            "sector": r[1] or "crypto",
            "asset": r[2] or "BTC",
            "markets": r[3],
            "weights": r[4],
            "fg_enabled": r[5],
            "fg_weight": r[6],
            "include_other": r[7],
        }
        for r in rows
    ]


def compute_latest_score(conn, indicator: dict) -> float | None:
    """Compute an indicator's latest score from current market_snapshots rows."""
    markets = _market_config(indicator)
    if markets:
        return _compute_market_latest_score(conn, indicator, markets)
    return _compute_category_latest_score(conn, indicator)


def _compute_market_latest_score(conn, indicator: dict, markets: dict) -> float | None:
    market_ids = list(markets.keys())
    if not market_ids:
        return None

    cur = conn.cursor()
    placeholders = ",".join(["%s"] * len(market_ids))
    sector = indicator.get("sector") or "crypto"
    asset = indicator.get("asset") or "BTC"
    cross_sector = _has_explicit_sector(markets)

    if cross_sector:
        cur.execute(
            f"SELECT MAX(date) FROM market_snapshots WHERE market_id IN ({placeholders})",
            market_ids,
        )
        latest_date = cur.fetchone()[0]
        if not latest_date:
            return None
        cur.execute(
            f"""
            SELECT market_id, sentiment_signal, weight
            FROM market_snapshots
            WHERE date = %s AND market_id IN ({placeholders})
            """,
            [latest_date] + market_ids,
        )
    else:
        cur.execute(
            f"""
            SELECT MAX(date)
            FROM market_snapshots
            WHERE sector = %s AND asset = %s AND market_id IN ({placeholders})
            """,
            [sector, asset] + market_ids,
        )
        latest_date = cur.fetchone()[0]
        if not latest_date:
            return None
        cur.execute(
            f"""
            SELECT market_id, sentiment_signal, weight
            FROM market_snapshots
            WHERE date = %s AND sector = %s AND asset = %s AND market_id IN ({placeholders})
            """,
            [latest_date, sector, asset] + market_ids,
        )

    market_rows = {r[0]: (float(r[1]), float(r[2])) for r in cur.fetchall() if r[1] is not None and r[2] is not None}
    num = 0.0
    den = 0.0
    for mid, cfg in markets.items():
        row = market_rows.get(mid)
        if not row:
            continue
        signal, base_weight = row
        user_weight, flip = _weight_and_flip(cfg)
        w = user_weight / 100.0
        sign = -1.0 if flip else 1.0
        num += w * sign * signal * base_weight
        den += w * base_weight

    score = ((num / den) + 1.0) * 50.0 if den > 0 else None
    return _blend_fear_greed(conn, indicator, latest_date, score)


def _compute_category_latest_score(conn, indicator: dict) -> float | None:
    sector = indicator.get("sector") or "crypto"
    asset = indicator.get("asset") or "BTC"
    weights = _category_weights(indicator)
    include_other = bool(indicator.get("include_other"))

    cur = conn.cursor()
    cur.execute(
        "SELECT MAX(date) FROM market_snapshots WHERE sector = %s AND asset = %s",
        (sector, asset),
    )
    latest_date = cur.fetchone()[0]
    if not latest_date:
        return None

    cur.execute(
        f"""
        SELECT {CATEGORY_CASE_SQL} AS cat,
               SUM(sentiment_signal * weight) AS ws,
               SUM(weight) AS wt
        FROM market_snapshots
        WHERE date = %s AND sector = %s AND asset = %s
        GROUP BY cat
        """,
        (latest_date, sector, asset),
    )
    cats = {r[0]: {"ws": float(r[1] or 0), "wt": float(r[2] or 0)} for r in cur.fetchall()}
    cat_keys = list(SECTOR_CATEGORIES.get(sector, SECTOR_CATEGORIES["crypto"]))
    if include_other:
        cat_keys.append("other")

    num = 0.0
    den = 0.0
    for cat in cat_keys:
        user_weight = float(weights.get(cat, 0) or 0) / 100.0
        cat_row = cats.get(cat)
        if not cat_row or user_weight == 0:
            continue
        num += user_weight * cat_row["ws"]
        den += user_weight * cat_row["wt"]

    score = ((num / den) + 1.0) * 50.0 if den > 0 else None
    return _blend_fear_greed(conn, indicator, latest_date, score)


def _blend_fear_greed(conn, indicator: dict, snapshot_date: str, score: float | None) -> float | None:
    if score is None or not indicator.get("fg_enabled"):
        return round(score, 1) if score is not None else None
    fg = _fear_greed_for_date(conn, snapshot_date)
    if fg is None:
        return round(score, 1)
    blend = float(indicator.get("fg_weight") or 30) / 100.0
    return round(score * (1.0 - blend) + fg * blend, 1)


def update_latest_scores(conn) -> int:
    """Update latest_score for every public indicator. Returns row count."""
    indicators = fetch_public_indicators(conn)
    updated = 0
    cur = conn.cursor()
    for indicator in indicators:
        score = compute_latest_score(conn, indicator)
        cur.execute("UPDATE indicators SET latest_score = %s WHERE id = %s", (score, indicator["id"]))
        updated += cur.rowcount
    conn.commit()
    return updated
