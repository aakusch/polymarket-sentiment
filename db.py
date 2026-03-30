"""Dual-backend storage layer: Postgres (via DATABASE_URL) or SQLite fallback."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import date, datetime
from pathlib import Path

from classifier import Classification
from config import DB_PATH
from scorer import MarketScore, SectorScore

log = logging.getLogger(__name__)

# ── Schema (Postgres dialect — SQLite uses CREATE TABLE IF NOT EXISTS natively) ──

PG_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS sector_snapshots (
        date TEXT NOT NULL,
        sector TEXT NOT NULL,
        composite DOUBLE PRECISION,
        composite_normalized DOUBLE PRECISION,
        market_count INTEGER,
        total_volume_24h DOUBLE PRECISION,
        total_open_interest DOUBLE PRECISION,
        avg_liquidity DOUBLE PRECISION,
        bullish_pct DOUBLE PRECISION,
        volume_concentration DOUBLE PRECISION,
        sub_scores_json TEXT,
        raw_json TEXT,
        PRIMARY KEY (date, sector)
    )""",
    """CREATE TABLE IF NOT EXISTS market_snapshots (
        date TEXT NOT NULL,
        market_id TEXT NOT NULL,
        event_id TEXT,
        question TEXT,
        classification TEXT,
        polarity TEXT,
        probability DOUBLE PRECISION,
        sentiment_signal DOUBLE PRECISION,
        weight DOUBLE PRECISION,
        volume_24h DOUBLE PRECISION,
        liquidity DOUBLE PRECISION,
        open_interest DOUBLE PRECISION,
        bid_ask_imbalance DOUBLE PRECISION,
        asset TEXT DEFAULT 'OTHER',
        end_date TEXT,
        PRIMARY KEY (date, market_id)
    )""",
    """CREATE TABLE IF NOT EXISTS classifications (
        market_id TEXT PRIMARY KEY,
        question TEXT,
        classification TEXT,
        polarity TEXT,
        method TEXT,
        asset TEXT DEFAULT 'OTHER',
        updated_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS reference_prices (
        date TEXT PRIMARY KEY,
        btc_price DOUBLE PRECISION,
        fear_greed INTEGER
    )""",
]

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS sector_snapshots (
    date TEXT NOT NULL,
    sector TEXT NOT NULL,
    composite REAL,
    composite_normalized REAL,
    market_count INTEGER,
    total_volume_24h REAL,
    total_open_interest REAL,
    avg_liquidity REAL,
    bullish_pct REAL,
    volume_concentration REAL,
    sub_scores_json TEXT,
    raw_json TEXT,
    PRIMARY KEY (date, sector)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
    date TEXT NOT NULL,
    market_id TEXT NOT NULL,
    event_id TEXT,
    question TEXT,
    classification TEXT,
    polarity TEXT,
    probability REAL,
    sentiment_signal REAL,
    weight REAL,
    volume_24h REAL,
    liquidity REAL,
    open_interest REAL,
    bid_ask_imbalance REAL,
    asset TEXT DEFAULT 'OTHER',
    end_date TEXT,
    PRIMARY KEY (date, market_id)
);

CREATE TABLE IF NOT EXISTS classifications (
    market_id TEXT PRIMARY KEY,
    question TEXT,
    classification TEXT,
    polarity TEXT,
    method TEXT,
    asset TEXT DEFAULT 'OTHER',
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS reference_prices (
    date TEXT PRIMARY KEY,
    btc_price REAL,
    fear_greed INTEGER
);
"""

MIGRATIONS = [
    ("ALTER TABLE market_snapshots ADD COLUMN asset TEXT DEFAULT 'OTHER'", "market_snapshots", "asset"),
    ("ALTER TABLE classifications ADD COLUMN asset TEXT DEFAULT 'OTHER'", "classifications", "asset"),
    ("ALTER TABLE market_snapshots ADD COLUMN end_date TEXT", "market_snapshots", "end_date"),
]


def _get_database_url() -> str | None:
    """Get DATABASE_URL from environment, loading .env if available."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    try:
        from dotenv import load_dotenv
        load_dotenv()
        return os.environ.get("DATABASE_URL")
    except ImportError:
        return None


class Database:
    """Dual-backend storage: Postgres when DATABASE_URL is set, SQLite otherwise."""

    def __init__(self, path: str | Path | None = None, database_url: str | None = None):
        # If an explicit SQLite path is given, skip Postgres detection
        if path:
            self._database_url = None
        else:
            self._database_url = database_url or _get_database_url()
        self._is_pg = bool(self._database_url)
        self._sqlite_path = str(path or DB_PATH)
        self._conn = None

    @property
    def is_postgres(self) -> bool:
        return self._is_pg

    def connect(self):
        """Connect and initialize schema. Returns the raw connection."""
        if self._conn is not None:
            return self._conn

        if self._is_pg:
            import psycopg
            from psycopg.rows import dict_row
            self._conn = psycopg.connect(self._database_url, row_factory=dict_row)
            for stmt in PG_SCHEMA:
                self._conn.execute(stmt)
            self._conn.commit()
            log.info("Connected to Postgres")
        else:
            self._conn = sqlite3.connect(self._sqlite_path)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SQLITE_SCHEMA)
            log.info("Connected to SQLite: %s", self._sqlite_path)

        self._run_migrations()
        return self._conn

    def _run_migrations(self):
        """Run schema migrations, skipping already-applied ones."""
        for sql, table, column in MIGRATIONS:
            try:
                if self._is_pg:
                    # Postgres: check information_schema before ALTER
                    row = self._conn.execute(
                        "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
                        (table, column),
                    ).fetchone()
                    if not row:
                        self._conn.execute(sql)
                    self._conn.commit()
                else:
                    self._conn.execute(sql)
                    self._conn.commit()
            except (sqlite3.OperationalError, Exception):
                if self._is_pg:
                    self._conn.rollback()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.close()

    # ── Helpers for dialect differences ────────────────────────────────────

    def _ph(self, n: int = 1) -> str:
        """Return n placeholders: %s for Postgres, ? for SQLite."""
        p = "%s" if self._is_pg else "?"
        return ", ".join([p] * n)

    def _upsert_sector(self) -> str:
        if self._is_pg:
            return """INSERT INTO sector_snapshots
                (date, sector, composite, composite_normalized, market_count,
                 total_volume_24h, total_open_interest, avg_liquidity,
                 bullish_pct, volume_concentration, sub_scores_json, raw_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (date, sector) DO UPDATE SET
                    composite = EXCLUDED.composite,
                    composite_normalized = EXCLUDED.composite_normalized,
                    market_count = EXCLUDED.market_count,
                    total_volume_24h = EXCLUDED.total_volume_24h,
                    total_open_interest = EXCLUDED.total_open_interest,
                    avg_liquidity = EXCLUDED.avg_liquidity,
                    bullish_pct = EXCLUDED.bullish_pct,
                    volume_concentration = EXCLUDED.volume_concentration,
                    sub_scores_json = EXCLUDED.sub_scores_json,
                    raw_json = EXCLUDED.raw_json"""
        return """INSERT OR REPLACE INTO sector_snapshots
            (date, sector, composite, composite_normalized, market_count,
             total_volume_24h, total_open_interest, avg_liquidity,
             bullish_pct, volume_concentration, sub_scores_json, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

    def _upsert_market(self) -> str:
        if self._is_pg:
            return """INSERT INTO market_snapshots
                (date, market_id, event_id, question, classification, polarity,
                 probability, sentiment_signal, weight, volume_24h, liquidity,
                 open_interest, bid_ask_imbalance, asset, end_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (date, market_id) DO UPDATE SET
                    event_id = EXCLUDED.event_id,
                    question = EXCLUDED.question,
                    classification = EXCLUDED.classification,
                    polarity = EXCLUDED.polarity,
                    probability = EXCLUDED.probability,
                    sentiment_signal = EXCLUDED.sentiment_signal,
                    weight = EXCLUDED.weight,
                    volume_24h = EXCLUDED.volume_24h,
                    liquidity = EXCLUDED.liquidity,
                    open_interest = EXCLUDED.open_interest,
                    bid_ask_imbalance = EXCLUDED.bid_ask_imbalance,
                    asset = EXCLUDED.asset,
                    end_date = EXCLUDED.end_date"""
        return """INSERT OR REPLACE INTO market_snapshots
            (date, market_id, event_id, question, classification, polarity,
             probability, sentiment_signal, weight, volume_24h, liquidity,
             open_interest, bid_ask_imbalance, asset, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

    def _upsert_classification(self) -> str:
        if self._is_pg:
            return """INSERT INTO classifications
                (market_id, question, classification, polarity, method, asset, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (market_id) DO UPDATE SET
                    question = EXCLUDED.question,
                    classification = EXCLUDED.classification,
                    polarity = EXCLUDED.polarity,
                    method = EXCLUDED.method,
                    asset = EXCLUDED.asset,
                    updated_at = EXCLUDED.updated_at"""
        return """INSERT OR REPLACE INTO classifications
            (market_id, question, classification, polarity, method, asset, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)"""

    def _upsert_ref_price(self) -> str:
        if self._is_pg:
            return """INSERT INTO reference_prices (date, btc_price, fear_greed)
                VALUES (%s, %s, %s)
                ON CONFLICT (date) DO UPDATE SET
                    btc_price = COALESCE(EXCLUDED.btc_price, reference_prices.btc_price),
                    fear_greed = COALESCE(EXCLUDED.fear_greed, reference_prices.fear_greed)"""
        return """INSERT INTO reference_prices (date, btc_price, fear_greed)
            VALUES (?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                btc_price = COALESCE(excluded.btc_price, btc_price),
                fear_greed = COALESCE(excluded.fear_greed, fear_greed)"""

    def _select(self, query: str, params: list | tuple = ()) -> list[dict]:
        """Execute a SELECT and return list of dicts (works for both backends)."""
        conn = self.connect()
        if self._is_pg:
            rows = conn.execute(query, params).fetchall()
            return rows  # Already dicts via dict_row
        else:
            rows = conn.execute(query, params).fetchall()
            return [dict(row) for row in rows]

    # ── Public API ─────────────────────────────────────────────────────────

    def save_snapshot(
        self,
        snapshot_date: date | str,
        sector: str,
        score: SectorScore,
    ):
        """Save a sector snapshot and all per-market scores."""
        conn = self.connect()
        d = str(snapshot_date)

        conn.execute(
            self._upsert_sector(),
            (
                d, sector,
                score.composite, score.composite_normalized, score.market_count,
                score.total_volume_24h, score.total_open_interest, score.avg_liquidity,
                score.bullish_pct, score.volume_concentration,
                json.dumps(score.sub_scores),
                json.dumps({
                    "composite": score.composite,
                    "composite_normalized": score.composite_normalized,
                    "market_count": score.market_count,
                    "sub_scores": score.sub_scores,
                }),
            ),
        )

        for ms in score.market_scores:
            asset = getattr(ms, "asset", "OTHER")
            end_date = getattr(ms, "end_date", None)
            conn.execute(
                self._upsert_market(),
                (
                    d, ms.market_id, ms.event_id, ms.question,
                    ms.classification, ms.polarity, ms.probability,
                    ms.sentiment_signal, ms.weight, ms.volume_24h,
                    ms.liquidity, ms.open_interest, ms.bid_ask_imbalance,
                    asset, end_date,
                ),
            )

        conn.commit()

    def save_classifications(self, classifications: dict[str, Classification]):
        """Upsert classification cache."""
        conn = self.connect()
        now = datetime.utcnow().isoformat()
        for c in classifications.values():
            conn.execute(
                self._upsert_classification(),
                (c.market_id, c.question, c.signal_type, c.polarity, c.method,
                 getattr(c, "asset", "OTHER"), now),
            )
        conn.commit()

    def load_classifications(self) -> dict[str, Classification]:
        """Load cached classifications."""
        rows = self._select("SELECT * FROM classifications")
        return {
            row["market_id"]: Classification(
                market_id=row["market_id"],
                question=row["question"],
                signal_type=row["classification"],
                polarity=row["polarity"],
                method=row["method"],
                asset=row.get("asset", "OTHER") or "OTHER",
            )
            for row in rows
        }

    def get_sector_timeseries(
        self, sector: str, *, start: str | None = None, end: str | None = None
    ) -> list[dict]:
        """Get sector composite scores over time."""
        ph = "%s" if self._is_pg else "?"
        query = f"SELECT * FROM sector_snapshots WHERE sector = {ph}"
        params: list = [sector]
        if start:
            query += f" AND date >= {ph}"
            params.append(start)
        if end:
            query += f" AND date <= {ph}"
            params.append(end)
        query += " ORDER BY date"
        return self._select(query, params)

    def get_market_snapshots(self, snapshot_date: str) -> list[dict]:
        """Get all market scores for a specific date."""
        ph = "%s" if self._is_pg else "?"
        return self._select(
            f"SELECT * FROM market_snapshots WHERE date = {ph} ORDER BY weight DESC",
            (snapshot_date,),
        )

    def get_reference_prices(
        self, *, start: str | None = None, end: str | None = None
    ) -> dict[str, dict]:
        """Get reference prices (BTC price + Fear & Greed) by date."""
        ph = "%s" if self._is_pg else "?"
        query = "SELECT * FROM reference_prices WHERE 1=1"
        params: list = []
        if start:
            query += f" AND date >= {ph}"
            params.append(start)
        if end:
            query += f" AND date <= {ph}"
            params.append(end)
        query += " ORDER BY date"
        rows = self._select(query, params)
        return {
            row["date"]: {
                "btc_price": row["btc_price"],
                "fear_greed": row["fear_greed"],
            }
            for row in rows
        }

    def get_latest_date(self, sector: str) -> str | None:
        """Get the most recent snapshot date for a sector."""
        ph = "%s" if self._is_pg else "?"
        rows = self._select(
            f"SELECT MAX(date) as d FROM sector_snapshots WHERE sector = {ph}",
            (sector,),
        )
        return rows[0]["d"] if rows else None

    def save_reference_prices(
        self,
        btc_prices: list[tuple[str, float]],
        fng_values: list[tuple[str, int]],
    ):
        """Merge BTC prices and F&G values into reference_prices table."""
        conn = self.connect()
        btc_by_date = {d: p for d, p in btc_prices}
        fng_by_date = {d: v for d, v in fng_values}
        all_dates = sorted(set(btc_by_date) | set(fng_by_date))

        for d in all_dates:
            btc = btc_by_date.get(d)
            fng = fng_by_date.get(d)
            conn.execute(self._upsert_ref_price(), (d, btc, fng))
        conn.commit()
        log.info("Saved reference prices for %d dates", len(all_dates))
