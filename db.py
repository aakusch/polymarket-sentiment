"""SQLite storage layer for sector snapshots, market snapshots, and classifications."""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

from classifier import Classification
from config import DB_PATH
from scorer import MarketScore, SectorScore

SCHEMA = """
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
    "ALTER TABLE market_snapshots ADD COLUMN asset TEXT DEFAULT 'OTHER'",
    "ALTER TABLE classifications ADD COLUMN asset TEXT DEFAULT 'OTHER'",
    "ALTER TABLE market_snapshots ADD COLUMN end_date TEXT",
]


class Database:
    """SQLite storage for polymarket sentiment data."""

    def __init__(self, path: str | Path | None = None):
        self.path = str(path or DB_PATH)
        self._conn: sqlite3.Connection | None = None

    def connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.path)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SCHEMA)
            self._run_migrations()
        return self._conn

    def _run_migrations(self):
        """Run schema migrations, skipping any that have already been applied."""
        for sql in MIGRATIONS:
            try:
                self._conn.execute(sql)
                self._conn.commit()
            except sqlite3.OperationalError:
                pass  # Column/table already exists

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.close()

    def save_snapshot(
        self,
        snapshot_date: date | str,
        sector: str,
        score: SectorScore,
    ):
        """Save a sector snapshot and all per-market scores."""
        conn = self.connect()
        d = str(snapshot_date)

        # Sector-level snapshot
        conn.execute(
            """INSERT OR REPLACE INTO sector_snapshots
               (date, sector, composite, composite_normalized, market_count,
                total_volume_24h, total_open_interest, avg_liquidity,
                bullish_pct, volume_concentration, sub_scores_json, raw_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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

        # Per-market snapshots
        for ms in score.market_scores:
            asset = getattr(ms, "asset", "OTHER")
            end_date = getattr(ms, "end_date", None)
            conn.execute(
                """INSERT OR REPLACE INTO market_snapshots
                   (date, market_id, event_id, question, classification, polarity,
                    probability, sentiment_signal, weight, volume_24h, liquidity,
                    open_interest, bid_ask_imbalance, asset, end_date)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                """INSERT OR REPLACE INTO classifications
                   (market_id, question, classification, polarity, method, asset, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (c.market_id, c.question, c.signal_type, c.polarity, c.method,
                 getattr(c, "asset", "OTHER"), now),
            )
        conn.commit()

    def load_classifications(self) -> dict[str, Classification]:
        """Load cached classifications."""
        conn = self.connect()
        rows = conn.execute("SELECT * FROM classifications").fetchall()
        return {
            row["market_id"]: Classification(
                market_id=row["market_id"],
                question=row["question"],
                signal_type=row["classification"],
                polarity=row["polarity"],
                method=row["method"],
                asset=row["asset"] if "asset" in row.keys() else "OTHER",
            )
            for row in rows
        }

    def get_sector_timeseries(
        self, sector: str, *, start: str | None = None, end: str | None = None
    ) -> list[dict]:
        """Get sector composite scores over time."""
        conn = self.connect()
        query = "SELECT * FROM sector_snapshots WHERE sector = ?"
        params: list = [sector]
        if start:
            query += " AND date >= ?"
            params.append(start)
        if end:
            query += " AND date <= ?"
            params.append(end)
        query += " ORDER BY date"
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def get_market_snapshots(self, snapshot_date: str) -> list[dict]:
        """Get all market scores for a specific date."""
        conn = self.connect()
        rows = conn.execute(
            "SELECT * FROM market_snapshots WHERE date = ? ORDER BY weight DESC",
            (snapshot_date,),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_reference_prices(
        self, *, start: str | None = None, end: str | None = None
    ) -> dict[str, dict]:
        """Get reference prices (BTC price + Fear & Greed) by date."""
        conn = self.connect()
        query = "SELECT * FROM reference_prices WHERE 1=1"
        params: list = []
        if start:
            query += " AND date >= ?"
            params.append(start)
        if end:
            query += " AND date <= ?"
            params.append(end)
        query += " ORDER BY date"
        rows = conn.execute(query, params).fetchall()
        return {
            row["date"]: {
                "btc_price": row["btc_price"],
                "fear_greed": row["fear_greed"],
            }
            for row in rows
        }

    def get_latest_date(self, sector: str) -> str | None:
        """Get the most recent snapshot date for a sector."""
        conn = self.connect()
        row = conn.execute(
            "SELECT MAX(date) as d FROM sector_snapshots WHERE sector = ?",
            (sector,),
        ).fetchone()
        return row["d"] if row else None
