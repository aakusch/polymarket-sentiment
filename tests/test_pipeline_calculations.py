import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import export as export_module
from db import Database
from export import OUTPUT_DIR, _write_json, build_export_meta, export_latest, export_sandbox
from indicator_scores import compute_latest_score, update_latest_scores
from scoring_contract import SCORING_VERSION
from scorer import MarketScore, _event_deduped_composite, sector_score_from_market_scores


def market_score(market_id, event_id, signal, weight=1.0, classification="price_above"):
    return MarketScore(
        market_id=market_id,
        event_id=event_id,
        question=market_id,
        classification=classification,
        polarity="bullish",
        probability=0.5,
        sentiment_signal=signal,
        weight=weight,
        volume_24h=100,
        liquidity=100,
        open_interest=100,
        bid_ask_imbalance=0,
        asset="BTC",
    )


class PipelineCalculationTests(unittest.TestCase):
    def test_event_dedup_caps_repeated_event_weight(self):
        scores = [
            market_score("m1", "event-a", 1.0),
            market_score("m2", "event-a", 1.0),
            market_score("m3", "event-b", -1.0),
        ]

        self.assertAlmostEqual(_event_deduped_composite(scores), 0.0)

    def test_sector_score_helper_is_used_for_canonical_subscores(self):
        scores = [
            market_score("m1", "event-a", 1.0, classification="price_above"),
            market_score("m2", "event-a", 1.0, classification="price_below"),
            market_score("m3", "event-b", -1.0, classification="regulatory_negative"),
        ]

        sector = sector_score_from_market_scores(scores, sector="crypto")

        self.assertAlmostEqual(sector.composite, 0.0)
        self.assertAlmostEqual(sector.sub_scores["price_targets"], 1.0)
        self.assertAlmostEqual(sector.sub_scores["regulatory"], -1.0)

    def test_export_latest_uses_stored_canonical_sub_scores(self):
        class FakeDb:
            is_postgres = False

            def get_latest_date(self, sector):
                return "2026-04-27"

            def get_market_snapshots(self, snapshot_date, sector=None):
                return [
                    {
                        "market_id": "m1",
                        "event_id": "event-a",
                        "question": "m1",
                        "classification": "price_above",
                        "polarity": "bullish",
                        "probability": 0.5,
                        "sentiment_signal": -1.0,
                        "weight": 1.0,
                        "volume_24h": 100,
                        "open_interest": 50,
                        "asset": "BTC",
                    }
                ]

            def get_sector_timeseries(self, sector, start=None, end=None):
                return [
                    {
                        "composite": 0.6,
                        "composite_normalized": 80,
                        "market_count": 1,
                        "total_volume_24h": 100,
                        "total_open_interest": 50,
                        "avg_liquidity": 25,
                        "bullish_pct": 100,
                        "sub_scores_json": json.dumps({"price_targets": 0.6}),
                    }
                ]

            def get_reference_prices(self, start=None, end=None):
                return {"2026-04-27": {}}

        latest = export_latest(FakeDb(), "crypto")

        self.assertEqual(latest["sub_scores"]["price_targets"]["score"], 0.6)
        self.assertEqual(latest["sub_scores"]["price_targets"]["normalized"], 80.0)

    def test_update_latest_scores_nulls_stale_scores(self):
        class FakeCursor:
            rowcount = 1

            def __init__(self):
                self.updates = []

            def execute(self, _query, params):
                self.updates.append(params)

        class FakeConn:
            def __init__(self):
                self.cur = FakeCursor()
                self.committed = False

            def cursor(self):
                return self.cur

            def commit(self):
                self.committed = True

        conn = FakeConn()
        indicators = [{"id": "ok"}, {"id": "stale"}]

        def score_for(_conn, indicator):
            return 66.6 if indicator["id"] == "ok" else None

        with patch("indicator_scores.fetch_public_indicators", return_value=indicators), \
             patch("indicator_scores.compute_latest_score", side_effect=score_for):
            updated = update_latest_scores(conn)

        self.assertEqual(updated, 2)
        self.assertEqual(conn.cur.updates, [(66.6, "ok"), (None, "stale")])
        self.assertTrue(conn.committed)

    def test_market_latest_score_uses_current_snapshot_date(self):
        class FakeCursor:
            def __init__(self, rows):
                self.rows = rows
                self.result = []

            def execute(self, query, params=None):
                if "SELECT MAX(date) FROM market_snapshots" in query:
                    self.result = [("2026-05-01",)]
                elif "SELECT market_id, sector, sentiment_signal, weight" in query:
                    snapshot_date = params[0]
                    self.result = self.rows.get(snapshot_date, [])
                else:
                    self.result = []

            def fetchone(self):
                return self.result[0] if self.result else (None,)

            def fetchall(self):
                return self.result

        class FakeConn:
            def __init__(self, rows):
                self.rows = rows

            def cursor(self):
                return FakeCursor(self.rows)

        stale = {"2026-04-10": [("m1", 1.0, 1.0)]}
        indicator = {"id": "stale", "markets": {"m1": {"w": 100}}, "fg_enabled": False}
        self.assertIsNone(compute_latest_score(FakeConn(stale), indicator))

        current = {"2026-05-01": [("m1", "crypto", 1.0, 1.0)]}
        self.assertEqual(compute_latest_score(FakeConn(current), indicator), 100.0)

    def test_market_latest_score_scopes_saved_markets_to_indicator_sector(self):
        class FakeCursor:
            def __init__(self):
                self.result = []

            def execute(self, query, params=None):
                if "SELECT MAX(date) FROM market_snapshots" in query:
                    self.result = [("2026-05-01",)]
                elif "SELECT market_id, sector, sentiment_signal, weight" in query:
                    self.result = [
                        ("same-id", "crypto", 1.0, 1.0),
                        ("same-id", "economy", -1.0, 1.0),
                    ]
                else:
                    self.result = []

            def fetchone(self):
                return self.result[0] if self.result else (None,)

            def fetchall(self):
                return self.result

        class FakeConn:
            def cursor(self):
                return FakeCursor()

        indicator = {"id": "btc", "sector": "crypto", "markets": {"same-id": {"w": 100}}, "fg_enabled": False}
        self.assertEqual(compute_latest_score(FakeConn(), indicator), 100.0)

    def test_pipeline_run_lifecycle_records_status(self):
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "pipeline.sqlite"
            with Database(db_path) as db:
                run_id = db.start_pipeline_run("snapshot", "crypto", {"date": "2026-04-27"})
                db.finish_pipeline_run(run_id, "success", summary={"market_count": 3})
                runs = db.get_pipeline_status()

        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["id"], run_id)
        self.assertEqual(runs[0]["status"], "success")
        self.assertEqual(runs[0]["scoring_version"], SCORING_VERSION)
        self.assertIn('"market_count": 3', runs[0]["summary_json"])

    def test_export_meta_merges_sector_status_and_pipeline_runs(self):
        with tempfile.TemporaryDirectory() as td:
            output = Path(td)
            db_path = output / "pipeline.sqlite"
            db = Database(db_path)
            with db:
                run_id = db.start_pipeline_run("snapshot", "crypto", {"date": "2026-04-27"})
                db.finish_pipeline_run(run_id, "success", summary={"market_count": 7})

            meta = build_export_meta(
                output=output,
                db=db,
                sector="crypto",
                latest_data={"date": "2026-04-27", "market_count": 7},
                sandbox_data={"assets": {"BTC": {}}},
                generated_at="2026-04-28T12:00:00Z",
                latest_name="latest.json",
                sandbox_name="sandbox.json",
            )

        self.assertEqual(meta["scoring_version"], SCORING_VERSION)
        self.assertEqual(meta["schema_version"], 2)
        self.assertEqual(meta["sectors"]["crypto"]["latest_date"], "2026-04-27")
        self.assertEqual(meta["sectors"]["crypto"]["files"]["latest"], "data/latest.json")
        self.assertEqual(meta["pipeline_runs"][0]["id"], run_id)

    def test_write_json_serializes_datetime_values(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "meta.json"
            _write_json(out, {"started_at": datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)})
            data = json.loads(out.read_text())

        self.assertEqual(data["started_at"], "2026-05-01T12:00:00+00:00")


class ExportTargetTests(unittest.TestCase):
    """The default export target is the directory the site actually serves.

    Regression guard: OUTPUT_DIR pointed at pipeline/dashboard/data/ while the site
    served public/ and CI validated + committed public/data/, so every scheduled
    export wrote where nothing read and the published JSON froze for months.
    """

    def test_output_dir_is_repo_public_data(self):
        repo_root = Path(export_module.__file__).resolve().parent.parent
        self.assertEqual(OUTPUT_DIR, repo_root / "public" / "data")

    def test_output_dir_is_absolute_and_cwd_independent(self):
        # CI runs `cd pipeline && python3 export.py`, so a cwd-relative path would
        # silently retarget the export.
        self.assertTrue(OUTPUT_DIR.is_absolute())


class SandboxBoundsTests(unittest.TestCase):
    """Both sandbox bounds hold: the rolling window and the per-asset market cap.

    Uncapped, this export reached ~150 MB for a single sector — over GitHub's
    100 MB file limit and unusable as a browser fetch.
    """

    COLUMNS = (
        "date, sector, market_id, event_id, question, classification, polarity, "
        "probability, sentiment_signal, weight, volume_24h, liquidity, "
        "open_interest, bid_ask_imbalance, asset, end_date"
    )

    def _seed(self, db, dates, markets, asset="BTC", sector="crypto"):
        conn = db.connect()
        for d in dates:
            for mid, vol in markets:
                conn.execute(
                    f"INSERT OR REPLACE INTO market_snapshots ({self.COLUMNS}) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (d, sector, mid, f"event-{mid}", f"question {mid}", "price_above",
                     "bullish", 0.5, 1.0, 1.0, vol, 100, 100, 0, asset, None),
                )
        conn.commit()

    def test_market_cap_keeps_highest_volume_and_reports_the_tail(self):
        dates = [(datetime.now(timezone.utc).date() - timedelta(days=i)).isoformat()
                 for i in range(6)]
        markets = [(f"m{i}", float(i)) for i in range(10)]  # m9 carries the most volume

        with tempfile.TemporaryDirectory() as td:
            with Database(Path(td) / "test.db") as db:
                self._seed(db, dates, markets)
                data = export_sandbox(db, sector="crypto", max_markets_per_asset=3)

        kept = data["assets"]["BTC"]["markets"]
        self.assertEqual(sorted(kept), ["m7", "m8", "m9"])
        self.assertEqual(data["bounds"]["dropped_markets"], {"BTC": 7})
        self.assertEqual(data["bounds"]["max_markets_per_asset"], 3)

    def test_window_excludes_snapshots_older_than_the_cutoff(self):
        today = datetime.now(timezone.utc).date()
        recent = [(today - timedelta(days=i)).isoformat() for i in range(6)]
        ancient = [(today - timedelta(days=400 + i)).isoformat() for i in range(6)]

        with tempfile.TemporaryDirectory() as td:
            with Database(Path(td) / "test.db") as db:
                self._seed(db, recent + ancient, [("m1", 100.0)])
                data = export_sandbox(db, sector="crypto", window_days=180)

        dates = data["assets"]["BTC"]["dates"]
        self.assertEqual(sorted(dates), sorted(recent))
        self.assertNotIn(ancient[0], dates)
        self.assertEqual(data["bounds"]["window_days"], 180)

    def test_zero_bounds_disable_both_limits(self):
        today = datetime.now(timezone.utc).date()
        dates = [(today - timedelta(days=i)).isoformat() for i in range(6)]
        old = [(today - timedelta(days=400)).isoformat()]

        with tempfile.TemporaryDirectory() as td:
            with Database(Path(td) / "test.db") as db:
                self._seed(db, dates + old, [(f"m{i}", float(i)) for i in range(10)])
                data = export_sandbox(db, sector="crypto", window_days=0,
                                      max_markets_per_asset=0)

        self.assertEqual(len(data["assets"]["BTC"]["markets"]), 10)
        self.assertIn(old[0], data["assets"]["BTC"]["dates"])
        self.assertEqual(data["bounds"]["dropped_markets"], {})

    def test_assets_below_the_date_floor_are_excluded(self):
        # A one-snapshot asset is a flat line the sandbox will happily correlate
        # against anything; non-crypto sectors used to publish these.
        today = datetime.now(timezone.utc).date()
        with tempfile.TemporaryDirectory() as td:
            with Database(Path(td) / "test.db") as db:
                self._seed(db, [(today - timedelta(days=i)).isoformat() for i in range(6)],
                           [("m1", 100.0)], asset="SPY", sector="stocks")
                self._seed(db, [today.isoformat()], [("m2", 100.0)],
                           asset="QQQ", sector="stocks")
                data = export_sandbox(db, sector="stocks")

        self.assertIn("SPY", data["assets"])
        self.assertNotIn("QQQ", data["assets"])
        self.assertEqual(data["bounds"]["min_dates"], 5)


if __name__ == "__main__":
    unittest.main()
