import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from db import Database
from export import build_export_meta, export_latest
from indicator_scores import update_latest_scores
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


if __name__ == "__main__":
    unittest.main()
