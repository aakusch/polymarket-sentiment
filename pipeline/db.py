"""Dual-backend storage layer: Postgres (via DATABASE_URL) or SQLite fallback."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import date, datetime
from pathlib import Path

from classifier import Classification
from config import DB_PATH
from scorer import MarketScore, SectorScore
from scoring_contract import SCORING_VERSION

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
        sector TEXT NOT NULL DEFAULT 'crypto',
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
        PRIMARY KEY (date, sector, market_id)
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
        fear_greed INTEGER,
        spx_price DOUBLE PRECISION,
        vix_price DOUBLE PRECISION,
        us10y_yield DOUBLE PRECISION,
        fed_rate DOUBLE PRECISION,
        unemployment DOUBLE PRECISION,
        eth_price DOUBLE PRECISION,
        sol_price DOUBLE PRECISION,
        ndx_price DOUBLE PRECISION,
        dji_price DOUBLE PRECISION,
        rut_price DOUBLE PRECISION,
        us2y_yield DOUBLE PRECISION,
        dxy_price DOUBLE PRECISION,
        gold_price DOUBLE PRECISION,
        oil_price DOUBLE PRECISION
    )""",
    """CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        sector TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        scoring_version TEXT,
        summary_json TEXT,
        error TEXT
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
    sector TEXT NOT NULL DEFAULT 'crypto',
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
    PRIMARY KEY (date, sector, market_id)
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
    fear_greed INTEGER,
    spx_price REAL,
    vix_price REAL,
    us10y_yield REAL,
    fed_rate REAL,
    unemployment REAL,
    eth_price REAL,
    sol_price REAL,
    ndx_price REAL,
    dji_price REAL,
    rut_price REAL,
    us2y_yield REAL,
    dxy_price REAL,
    gold_price REAL,
    oil_price REAL
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    sector TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER,
    scoring_version TEXT,
    summary_json TEXT,
    error TEXT
);
"""

MIGRATIONS = [
    ("ALTER TABLE market_snapshots ADD COLUMN asset TEXT DEFAULT 'OTHER'", "market_snapshots", "asset"),
    ("ALTER TABLE classifications ADD COLUMN asset TEXT DEFAULT 'OTHER'", "classifications", "asset"),
    ("ALTER TABLE market_snapshots ADD COLUMN end_date TEXT", "market_snapshots", "end_date"),
    ("ALTER TABLE market_snapshots ADD COLUMN sector TEXT DEFAULT 'crypto'", "market_snapshots", "sector"),
    ("ALTER TABLE reference_prices ADD COLUMN spx_price DOUBLE PRECISION", "reference_prices", "spx_price"),
    ("ALTER TABLE reference_prices ADD COLUMN vix_price DOUBLE PRECISION", "reference_prices", "vix_price"),
    ("ALTER TABLE reference_prices ADD COLUMN us10y_yield DOUBLE PRECISION", "reference_prices", "us10y_yield"),
    ("ALTER TABLE reference_prices ADD COLUMN fed_rate DOUBLE PRECISION", "reference_prices", "fed_rate"),
    ("ALTER TABLE reference_prices ADD COLUMN unemployment DOUBLE PRECISION", "reference_prices", "unemployment"),
    ("ALTER TABLE reference_prices ADD COLUMN eth_price DOUBLE PRECISION", "reference_prices", "eth_price"),
    ("ALTER TABLE reference_prices ADD COLUMN sol_price DOUBLE PRECISION", "reference_prices", "sol_price"),
    ("ALTER TABLE reference_prices ADD COLUMN ndx_price DOUBLE PRECISION", "reference_prices", "ndx_price"),
    ("ALTER TABLE reference_prices ADD COLUMN dji_price DOUBLE PRECISION", "reference_prices", "dji_price"),
    ("ALTER TABLE reference_prices ADD COLUMN rut_price DOUBLE PRECISION", "reference_prices", "rut_price"),
    ("ALTER TABLE reference_prices ADD COLUMN us2y_yield DOUBLE PRECISION", "reference_prices", "us2y_yield"),
    ("ALTER TABLE reference_prices ADD COLUMN dxy_price DOUBLE PRECISION", "reference_prices", "dxy_price"),
    ("ALTER TABLE reference_prices ADD COLUMN gold_price DOUBLE PRECISION", "reference_prices", "gold_price"),
    ("ALTER TABLE reference_prices ADD COLUMN oil_price DOUBLE PRECISION", "reference_prices", "oil_price"),
]


def _get_database_url() -> str | None:
    """Get DATABASE_URL from environment, loading .env if available."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url.replace("\\n", "").strip()
    try:
        from dotenv import load_dotenv
        load_dotenv()
        url = os.environ.get("DATABASE_URL")
        return url.replace("\\n", "").strip() if url else None
    except ImportError:
        return None


class Database:
    """Dual-backend storage: Postgres when DATABASE_URL is set, SQLite otherwise."""

    def __init__(self, path: str | Path | None = None, database_url: str | None = None):
        # If an explicit SQLite path is given, skip Postgres detection
        if path:
            self._database_url = None
        else:
            self._database_url = database_url.replace("\\n", "").strip() if database_url else _get_database_url()
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
        self._ensure_market_snapshot_sector_pk()

    def _ensure_market_snapshot_sector_pk(self):
        """Keep same market IDs from different sectors from overwriting each other."""
        if self._is_pg:
            rows = self._conn.execute(
                """
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = 'market_snapshots'::regclass AND i.indisprimary
                ORDER BY array_position(i.indkey, a.attnum)
                """
            ).fetchall()
            cols = [r["attname"] for r in rows]
            if cols == ["date", "sector", "market_id"]:
                return
            self._conn.execute("UPDATE market_snapshots SET sector = 'crypto' WHERE sector IS NULL")
            constraint = self._conn.execute(
                """
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'market_snapshots'::regclass AND contype = 'p'
                """
            ).fetchone()
            if constraint:
                self._conn.execute(f'ALTER TABLE market_snapshots DROP CONSTRAINT "{constraint["conname"]}"')
            self._conn.execute("ALTER TABLE market_snapshots ADD PRIMARY KEY (date, sector, market_id)")
            self._conn.commit()
            return

        info = self._conn.execute("PRAGMA table_info(market_snapshots)").fetchall()
        pk_cols = [row["name"] for row in sorted([r for r in info if r["pk"]], key=lambda r: r["pk"])]
        if pk_cols == ["date", "sector", "market_id"]:
            return
        self._conn.executescript(
            """
            CREATE TABLE market_snapshots_new (
                date TEXT NOT NULL,
                sector TEXT NOT NULL DEFAULT 'crypto',
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
                PRIMARY KEY (date, sector, market_id)
            );
            INSERT OR REPLACE INTO market_snapshots_new
                (date, sector, market_id, event_id, question, classification, polarity,
                 probability, sentiment_signal, weight, volume_24h, liquidity,
                 open_interest, bid_ask_imbalance, asset, end_date)
            SELECT date, COALESCE(sector, 'crypto'), market_id, event_id, question, classification, polarity,
                   probability, sentiment_signal, weight, volume_24h, liquidity,
                   open_interest, bid_ask_imbalance, asset, end_date
            FROM market_snapshots;
            DROP TABLE market_snapshots;
            ALTER TABLE market_snapshots_new RENAME TO market_snapshots;
            """
        )
        self._conn.commit()

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
                 open_interest, bid_ask_imbalance, asset, end_date, sector)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (date, sector, market_id) DO UPDATE SET
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
                    end_date = EXCLUDED.end_date,
                    sector = EXCLUDED.sector"""
        return """INSERT OR REPLACE INTO market_snapshots
            (date, market_id, event_id, question, classification, polarity,
             probability, sentiment_signal, weight, volume_24h, liquidity,
             open_interest, bid_ask_imbalance, asset, end_date, sector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

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

    _REF_COLS = [
        "btc_price", "fear_greed", "spx_price", "vix_price", "us10y_yield", "fed_rate", "unemployment",
        "eth_price", "sol_price", "ndx_price", "dji_price", "rut_price", "us2y_yield", "dxy_price",
        "gold_price", "oil_price",
    ]

    def _upsert_ref_price(self) -> str:
        cols = self._REF_COLS
        col_list = ", ".join(cols)
        if self._is_pg:
            ph = ", ".join(["%s"] * (1 + len(cols)))
            coalesce = ", ".join(
                f"{c} = COALESCE(EXCLUDED.{c}, reference_prices.{c})" for c in cols
            )
            return f"""INSERT INTO reference_prices (date, {col_list})
                VALUES ({ph})
                ON CONFLICT (date) DO UPDATE SET {coalesce}"""
        ph = ", ".join(["?"] * (1 + len(cols)))
        coalesce = ", ".join(
            f"{c} = COALESCE(excluded.{c}, {c})" for c in cols
        )
        return f"""INSERT INTO reference_prices (date, {col_list})
            VALUES ({ph})
            ON CONFLICT(date) DO UPDATE SET {coalesce}"""

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
                    asset, end_date, sector,
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

    def start_pipeline_run(self, job_type: str, sector: str | None = None, summary: dict | None = None) -> str:
        """Record the start of a pipeline job and return its run id."""
        conn = self.connect()
        run_id = str(uuid.uuid4())
        started_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        summary_payload = json.dumps(summary or {})
        ph = self._ph(10)
        conn.execute(
            f"""INSERT INTO pipeline_runs
                (id, job_type, sector, status, started_at, finished_at, duration_ms, scoring_version, summary_json, error)
                VALUES ({ph})""",
            (
                run_id,
                job_type,
                sector,
                "running",
                started_at,
                None,
                None,
                SCORING_VERSION,
                summary_payload,
                None,
            ),
        )
        conn.commit()
        return run_id

    def finish_pipeline_run(
        self,
        run_id: str,
        status: str,
        *,
        summary: dict | None = None,
        error: str | None = None,
    ):
        """Mark a pipeline run complete, failed, or skipped."""
        conn = self.connect()
        rows = self._select("SELECT started_at FROM pipeline_runs WHERE id = " + self._ph(), (run_id,))
        started_at = rows[0]["started_at"] if rows else None
        finished_at_dt = datetime.utcnow()
        duration_ms = None
        if started_at:
            try:
                started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00")).replace(tzinfo=None)
                duration_ms = int((finished_at_dt - started).total_seconds() * 1000)
            except (TypeError, ValueError):
                duration_ms = None
        finished_at = finished_at_dt.isoformat(timespec="seconds") + "Z"
        conn.execute(
            f"""UPDATE pipeline_runs
                SET status = {self._ph()}, finished_at = {self._ph()}, duration_ms = {self._ph()},
                    summary_json = {self._ph()}, error = {self._ph()}
                WHERE id = {self._ph()}""",
            (status, finished_at, duration_ms, json.dumps(summary or {}), error, run_id),
        )
        conn.commit()

    def get_pipeline_status(self, limit: int = 20) -> list[dict]:
        """Return recent pipeline runs for health and metadata surfaces."""
        ph = "%s" if self._is_pg else "?"
        return self._select(
            f"""SELECT id, job_type, sector, status, started_at, finished_at, duration_ms,
                       scoring_version, summary_json, error
                FROM pipeline_runs
                ORDER BY started_at DESC
                LIMIT {ph}""",
            (limit,),
        )

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

    def get_market_snapshots(self, snapshot_date: str, sector: str | None = None) -> list[dict]:
        """Get market scores for a specific date, optionally scoped to a sector."""
        ph = "%s" if self._is_pg else "?"
        query = f"SELECT * FROM market_snapshots WHERE date = {ph}"
        params: list = [snapshot_date]
        if sector:
            query += f" AND sector = {ph}"
            params.append(sector)
        query += " ORDER BY weight DESC"
        return self._select(query, params)

    def get_reference_prices(
        self, *, start: str | None = None, end: str | None = None
    ) -> dict[str, dict]:
        """Get reference prices (all columns) by date."""
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
        result = {}
        for row in rows:
            entry = {}
            for col in self._REF_COLS:
                val = row.get(col)
                if val is not None:
                    entry[col] = val
            result[row["date"]] = entry
        return result

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
        feeds: dict[str, list[tuple[str, float]]] | list | None = None,
        fng_values: list[tuple[str, int]] | None = None,
    ):
        """Merge reference price feeds into reference_prices table.

        Accepts either:
        - feeds: dict mapping feed_name -> [(date, value), ...] (new format)
        - Legacy: feeds as btc_prices list, fng_values as F&G list (backward compat)
        """
        conn = self.connect()

        # Legacy two-arg call: save_reference_prices(btc_list, fng_list)
        if isinstance(feeds, list):
            feeds = {"btc_price": feeds}
            if fng_values:
                feeds["fear_greed"] = fng_values

        if not feeds:
            return

        # Build per-date lookup for each feed
        by_date: dict[str, dict[str, float | None]] = {}
        for feed_name, data_points in feeds.items():
            if feed_name not in self._REF_COLS:
                log.warning("Unknown reference feed '%s' — skipping", feed_name)
                continue
            for d, val in data_points:
                if d not in by_date:
                    by_date[d] = {}
                by_date[d][feed_name] = val

        for d in sorted(by_date):
            vals = by_date[d]
            row = [d] + [vals.get(col) for col in self._REF_COLS]
            conn.execute(self._upsert_ref_price(), tuple(row))
        conn.commit()
        log.info("Saved reference prices for %d dates across %d feeds", len(by_date), len(feeds))
