"""Re-derive classification and sentiment for stored snapshots under current rules.

Why this exists: classification, polarity and sentiment_signal are computed at
snapshot time and written into market_snapshots. Fixing the classifier therefore
only changes FUTURE rows — every historical row keeps the verdict the broken
substring matcher gave it, so any research over history measures the bug rather
than the market.

This is a pure re-derivation from fields already stored at the time of the
snapshot — the question text and that day's probability — so it introduces no
lookahead: nothing here consults information that did not exist on the snapshot
date. Weights are left untouched for the same reason; they were computed from
point-in-time volume and liquidity that we no longer have.

Sector membership canNOT be re-derived (event tags were never stored), so rows
keep their original sector. Membership only improves going forward.

    python3 reclassify.py --dry-run              # report, write nothing
    python3 reclassify.py --sector crypto        # one sector
    python3 reclassify.py                        # all sectors
"""

from __future__ import annotations

import logging
from collections import defaultdict

import click

from classifier import classify_by_keywords
from db import Database
from scorer import MarketScore, sector_score_from_market_scores
from config import SIGNAL_COMPRESSION_K
from math import tanh

log = logging.getLogger(__name__)


def rederive(question: str, probability: float, sector: str) -> tuple[str, str, float]:
    """Return (classification, polarity, sentiment_signal) under current rules."""
    result = classify_by_keywords(question or "", sector=sector)
    if not result:
        return "unclassified", "neutral", 0.0
    signal_type, polarity = result
    if polarity == "neutral":
        return signal_type, polarity, 0.0
    p = max(0.0, min(1.0, float(probability if probability is not None else 0.5)))
    signal = tanh(SIGNAL_COMPRESSION_K * (p - 0.5)) if polarity == "bullish" \
        else tanh(SIGNAL_COMPRESSION_K * (0.5 - p))
    return signal_type, polarity, signal


@click.command()
@click.option("--db", "db_path", default=None, help="SQLite path (default: DATABASE_URL)")
@click.option("--sector", default=None, help="Limit to one sector")
@click.option("--dry-run", is_flag=True, help="Report changes, write nothing")
@click.option("-v", "--verbose", is_flag=True)
def main(db_path: str | None, sector: str | None, dry_run: bool, verbose: bool):
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-8s %(message)s", datefmt="%H:%M:%S")
    db = Database(db_path)
    with db:
        ph = "%s" if db.is_postgres else "?"
        where, params = "", []
        if sector:
            where, params = f"WHERE sector = {ph}", [sector]
        rows = db._select(f"""
            SELECT date, sector, market_id, question, classification, polarity,
                   probability, sentiment_signal, weight, event_id, volume_24h,
                   liquidity, open_interest, bid_ask_imbalance, asset, end_date
            FROM market_snapshots {where}
        """, params)
        log.info("Loaded %d snapshot rows", len(rows))

        changed = 0
        moves: dict[tuple[str, str], int] = defaultdict(int)
        updates = []
        by_day: dict[tuple[str, str], list[MarketScore]] = defaultdict(list)

        for r in rows:
            sec = r["sector"]
            cls, pol, sig = rederive(r["question"], r["probability"], sec)
            if cls != r["classification"]:
                changed += 1
                moves[(r["classification"], cls)] += 1
            updates.append((cls, pol, sig, r["date"], sec, r["market_id"]))
            by_day[(r["date"], sec)].append(MarketScore(
                market_id=r["market_id"], event_id=r.get("event_id") or r["market_id"],
                question=r["question"], classification=cls, polarity=pol,
                probability=r["probability"] or 0.5, sentiment_signal=sig,
                weight=r["weight"] or 0.0, volume_24h=r["volume_24h"] or 0.0,
                liquidity=r["liquidity"] or 0.0, open_interest=r["open_interest"] or 0.0,
                bid_ask_imbalance=r["bid_ask_imbalance"] or 0.0,
                asset=r.get("asset") or "OTHER", end_date=r.get("end_date"),
            ))

        log.info("Reclassified %d of %d rows (%.1f%%)", changed, len(rows),
                 100 * changed / len(rows) if rows else 0)
        for (old, new), n in sorted(moves.items(), key=lambda kv: -kv[1])[:15]:
            log.info("  %-24s -> %-24s %6d", old, new, n)

        # What the composites become once the corrected signals are aggregated.
        recomputed = {}
        for (d, sec), scores in sorted(by_day.items()):
            s = sector_score_from_market_scores(scores, sector=sec)
            recomputed[(d, sec)] = s
        for sec in sorted({k[1] for k in recomputed}):
            days = [(d, s) for (d, ss), s in recomputed.items() if ss == sec for d in [d]]
            days.sort()
            if not days:
                continue
            last_d, last = days[-1]
            log.info("%s @ %s: score %.1f, coverage %.1f%% (%d/%d), gate %s",
                     sec, last_d, last.composite_normalized, last.classified_pct,
                     last.scored_market_count, last.market_count,
                     "PASS" if last.coverage_ok else "FLAG")

        if dry_run:
            log.info("DRY RUN — nothing written")
            return

        conn = db.connect()
        for cls, pol, sig, d, sec, mid in updates:
            conn.execute(
                f"""UPDATE market_snapshots SET classification = {ph}, polarity = {ph},
                    sentiment_signal = {ph}
                    WHERE date = {ph} AND sector = {ph} AND market_id = {ph}""",
                (cls, pol, sig, d, sec, mid),
            )
        for (d, sec), s in recomputed.items():
            conn.execute(
                f"""UPDATE sector_snapshots SET composite = {ph}, composite_normalized = {ph},
                    sub_scores_json = {ph} WHERE date = {ph} AND sector = {ph}""",
                (s.composite, s.composite_normalized,
                 __import__("json").dumps(s.sub_scores), d, sec),
            )
        conn.commit()
        log.info("Wrote %d market rows and %d sector rows", len(updates), len(recomputed))


if __name__ == "__main__":
    main()
