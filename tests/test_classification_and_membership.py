"""Guards for the three defects that made the composite not mean what it claimed.

C1 sector membership, C2 keyword classification, C3 unclassified dilution.
"""

import unittest
from datetime import datetime, timedelta, timezone

from classifier import classify_by_keywords, classify_market, extract_asset
from discovery import Event, Market, event_matches_sector
from scorer import MarketScore, sector_score_from_market_scores


def market(mid="m1", question="q", volume=1000.0, end_days=180):
    end = (datetime.now(timezone.utc) + timedelta(days=end_days)).isoformat()
    return Market(
        id=mid, event_id=f"e-{mid}", question=question, slug=mid,
        outcomes=["Yes", "No"], outcome_prices=[0.6, 0.4], clob_token_ids=[],
        volume=volume, volume_24h=volume, liquidity=volume, open_interest=volume,
        best_bid=0.59, best_ask=0.61, spread=0.02,
        start_date=None, end_date=end, active=True, closed=False, neg_risk=False,
    )


def event(title="t", tags=None, questions=()):
    return Event(
        id="e1", title=title, slug="t", volume=0, volume_24h=0, liquidity=0,
        open_interest=0, active=True, closed=False, start_date=None, end_date=None,
        tags=[{"label": t} for t in (tags or [])],
        markets=[market(f"m{i}", q) for i, q in enumerate(questions)],
    )


def score(mid, classification, signal, weight=1.0, event_id=None):
    return MarketScore(
        market_id=mid, event_id=event_id or f"e-{mid}", question=mid,
        classification=classification, polarity="bullish", probability=0.6,
        sentiment_signal=signal, weight=weight, volume_24h=100.0,
        liquidity=100.0, open_interest=100.0, bid_ask_imbalance=0.0,
    )


class KeywordClassificationTests(unittest.TestCase):
    """Substring matching produced sign errors; these are the real ones it made."""

    def test_word_boundaries_stop_substring_false_positives(self):
        # "g(over)nment" used to match the bullish price-target rule via "over",
        # and "W(hit)e House" via "hit".
        self.assertNotEqual(
            classify_by_keywords("Will the government shut down before October?", "politics"),
            ("price_above", "bullish"),
        )
        self.assertIsNone(
            classify_by_keywords("Will Trump leave the White House before 2027?", "politics")
        )
        # "JPMorgan (ban)k" matched regulatory_negative.
        self.assertNotEqual(
            classify_by_keywords("Will JPMorgan bank launch a stablecoin?", "crypto"),
            ("regulatory_negative", "bearish"),
        )

    def test_macro_above_is_not_a_bullish_price_target(self):
        # The sign of the indicator depended on this: a higher inflation or
        # unemployment print is risk-off, not a bullish price break.
        self.assertEqual(
            classify_by_keywords("Will CPI inflation be above 3%?", "economy"),
            ("inflation_rising", "bearish"),
        )
        self.assertEqual(
            classify_by_keywords("Will unemployment be above 5%?", "economy"),
            ("employment_negative", "bearish"),
        )

    def test_specificity_beats_rule_order(self):
        # "inflation above" must win over "above" wherever both could apply.
        self.assertEqual(
            classify_by_keywords("Will inflation fall below 2% in 2026?", "economy"),
            ("inflation_falling", "bullish"),
        )

    def test_phrase_rules_tolerate_filler_words(self):
        # Real questions read "inflation be above", not "inflation above".
        self.assertEqual(
            classify_by_keywords("Will core CPI inflation come in above 3.2%?", "economy"),
            ("inflation_rising", "bearish"),
        )

    def test_rules_are_scoped_to_their_sector(self):
        # Price rules exist for crypto/stocks and must not leak into economy.
        self.assertEqual(
            classify_by_keywords("Will Bitcoin close above $150k?", "crypto"),
            ("price_above", "bullish"),
        )
        self.assertNotEqual(
            classify_by_keywords("Will unemployment be above 5%?", "economy"),
            ("price_above", "bullish"),
        )

    def test_deescalation_is_not_scored_as_escalation(self):
        self.assertEqual(
            classify_by_keywords("Will Ukraine and Russia reach a ceasefire?", "politics"),
            ("geopolitical_deescalation", "bullish"),
        )
        self.assertEqual(
            classify_by_keywords("Will Russia invade another country in 2026?", "politics"),
            ("geopolitical_event", "bearish"),
        )

    def test_unmatched_questions_stay_unclassified(self):
        c = classify_market(market(question="Will aliens be confirmed to exist?"), sector="economy")
        self.assertEqual(c.signal_type, "unclassified")
        self.assertEqual(c.polarity, "neutral")


class SectorMembershipTests(unittest.TestCase):
    """Every sector used to score the same universe; membership must subtract."""

    def test_sports_never_qualifies_for_any_sector(self):
        e = event("LoL: T1 vs DN SOOPers", tags=["Esports", "league of legends", "Games"])
        for sector in ("crypto", "stocks", "economy", "politics"):
            self.assertFalse(event_matches_sector(e, sector), sector)

    def test_sector_tags_admit_their_own_and_exclude_others(self):
        e = event("Bitcoin above $150k?", tags=["Crypto", "Bitcoin"])
        self.assertTrue(event_matches_sector(e, "crypto"))
        self.assertFalse(event_matches_sector(e, "politics"))

    def test_tagged_event_matching_no_sector_label_is_excluded(self):
        # Tags said what it is, and it is not one of ours — don't fall through
        # to question patterns and pick it up on an incidental word.
        e = event("Best Picture winner?", tags=["Movies", "Awards"])
        for sector in ("crypto", "stocks", "economy", "politics"):
            self.assertFalse(event_matches_sector(e, sector), sector)

    def test_untagged_events_fall_back_to_question_patterns(self):
        e = event("Will the Fed cut rates in September?", tags=[],
                  questions=("Will the Fed cut rates in September?",))
        self.assertTrue(event_matches_sector(e, "economy"))
        self.assertFalse(event_matches_sector(e, "crypto"))

    def test_broad_business_tag_does_not_pull_macro_into_stocks(self):
        e = event("How many Fed rate cuts in 2026?",
                  tags=["Fed Rates", "Economic Policy", "Business", "Finance"])
        self.assertTrue(event_matches_sector(e, "economy"))
        self.assertFalse(event_matches_sector(e, "stocks"))


class CompositeDilutionTests(unittest.TestCase):
    """Unclassified markets carried weight with zero signal, pinning scores at 50."""

    def test_unclassified_markets_do_not_dilute_the_composite(self):
        directional = [score(f"d{i}", "price_above", 0.8) for i in range(30)]
        dead = [score(f"u{i}", "unclassified", 0.0) for i in range(300)]

        pure = sector_score_from_market_scores(directional, sector="crypto")
        mixed = sector_score_from_market_scores(directional + dead, sector="crypto")

        self.assertAlmostEqual(pure.composite, mixed.composite, places=6)
        self.assertGreater(mixed.composite_normalized, 85)

    def test_coverage_is_reported_not_hidden(self):
        scores = [score(f"d{i}", "price_above", 0.8) for i in range(30)]
        scores += [score(f"u{i}", "unclassified", 0.0) for i in range(70)]
        result = sector_score_from_market_scores(scores, sector="crypto")

        self.assertEqual(result.market_count, 100)      # observed
        self.assertEqual(result.scored_market_count, 30)  # actually scored
        self.assertAlmostEqual(result.classified_pct, 30.0)

    def test_neutral_range_markets_stay_out_of_a_directional_average(self):
        scores = [score(f"d{i}", "price_above", 0.8) for i in range(30)]
        scores += [score(f"r{i}", "price_range", 0.0) for i in range(30)]
        result = sector_score_from_market_scores(scores, sector="crypto")
        self.assertEqual(result.scored_market_count, 30)

    def test_thin_coverage_fails_the_gate(self):
        # Politics scored 86.0 off 5 of 1,117 markets once dilution stopped
        # hiding it. That must be flagged, not published as a reading.
        scores = [score(f"d{i}", "geopolitical_event", 0.9) for i in range(5)]
        scores += [score(f"u{i}", "unclassified", 0.0) for i in range(1000)]
        result = sector_score_from_market_scores(scores, sector="politics")

        self.assertFalse(result.coverage_ok)
        self.assertLess(result.classified_pct, 1.0)

    def test_healthy_coverage_passes_the_gate(self):
        scores = [score(f"d{i}", "price_above", 0.4) for i in range(90)]
        scores += [score(f"u{i}", "unclassified", 0.0) for i in range(10)]
        result = sector_score_from_market_scores(scores, sector="crypto")

        self.assertTrue(result.coverage_ok)
        self.assertAlmostEqual(result.classified_pct, 90.0)


if __name__ == "__main__":
    unittest.main()
