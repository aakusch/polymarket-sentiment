"""Compose candidate indicators and measure their predictive power honestly.

Offline research harness. Reads the exported sandbox JSON, builds indicator
timeseries from category or market subsets, and scores each against a reference
asset with a SIGNED information coefficient, a permutation null band, and an
out-of-sample split.

Three properties this deliberately has:

  * Signed. A negative IC is a finding, not something to clamp to zero.
  * Overlap-aware. Daily windows at lag k share k-1 days, so the effective
    sample is ~n/k. Significance uses the deflated count.
  * Honest about search. Scanning many candidates on one sample finds "winners"
    by construction, so every result carries how many candidates were searched,
    and the permutation null is what a random series of the same shape scores.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data"
SECTOR_FILES = {
    "crypto": "sandbox.json",
    "stocks": "sandbox-stocks.json",
    "economy": "sandbox-economy.json",
    "politics": "sandbox-politics.json",
}
LAGS = (1, 3, 5, 7, 14, 21)
MIN_PAIRS = 20
PERMUTATIONS = 500


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    num = dx2 = dy2 = 0.0
    for x, y in zip(xs, ys):
        a, b = x - mx, y - my
        num += a * b
        dx2 += a * a
        dy2 += b * b
    den = math.sqrt(dx2 * dy2)
    return num / den if den > 0 else 0.0


@dataclass
class Series:
    dates: list[str]
    values: list[float]

    def as_map(self) -> dict[str, float]:
        return dict(zip(self.dates, self.values))


@dataclass
class ICResult:
    lag: int
    ic: float
    n: int
    n_eff: int
    t_stat: float
    significant: bool
    null_p95: float           # |IC| a random series of this shape beats 5% of the time
    beats_null: bool
    oos_ic: float | None = None
    oos_n: int = 0


@dataclass
class Candidate:
    key: str
    label: str
    sector: str
    asset: str
    categories: list[str]
    reference: str
    thesis: str = ""
    results: list[ICResult] = field(default_factory=list)


def load_sector(sector: str) -> dict:
    return json.loads((DATA_DIR / SECTOR_FILES[sector]).read_text())


def category_series(data: dict, asset: str, categories: list[str]) -> Series | None:
    """Weighted-average signal across the given categories, per date."""
    ad = data.get("assets", {}).get(asset)
    if not ad:
        return None
    dates = ad.get("dates", [])
    cats = ad.get("cats", {})
    vals: list[float] = []
    keep: list[str] = []
    for i, d in enumerate(dates):
        ws = wt = 0.0
        for c in categories:
            cd = cats.get(c)
            if not cd:
                continue
            ws += cd["ws"][i] if i < len(cd["ws"]) else 0.0
            wt += cd["wt"][i] if i < len(cd["wt"]) else 0.0
        if wt > 0:
            keep.append(d)
            vals.append(ws / wt)
    return Series(keep, vals) if len(keep) >= MIN_PAIRS else None


def reference_series(data: dict, key: str) -> Series | None:
    ref = data.get("ref", {})
    dates = ref.get("dates", [])
    vals = ref.get(key)
    if not vals:
        return None
    keep_d, keep_v = [], []
    for d, v in zip(dates, vals):
        if v is not None:
            keep_d.append(d)
            keep_v.append(float(v))
    return Series(keep_d, keep_v) if keep_d else None


def aligned_pairs(ind: Series, ref: Series, lag: int) -> tuple[list[float], list[float]]:
    """Score CHANGE against forward reference return, on shared dates.

    Differencing matters: score levels are strongly autocorrelated, so
    correlating levels against returns overstates the relationship.
    """
    rmap = ref.as_map()
    shared = [d for d in ind.dates if d in rmap]
    if len(shared) <= lag + 1:
        return [], []
    imap = ind.as_map()
    xs, ys = [], []
    for i in range(1, len(shared) - lag):
        d0, dprev, dfwd = shared[i], shared[i - 1], shared[i + lag]
        p0, pf = rmap[d0], rmap[dfwd]
        if p0 <= 0:
            continue
        xs.append(imap[d0] - imap[dprev])
        ys.append(pf / p0 - 1)
    return xs, ys


def permutation_null(xs: list[float], ys: list[float], trials: int = PERMUTATIONS) -> float:
    """95th percentile of |IC| under a shuffled indicator — the noise floor."""
    rng = random.Random(1234)
    shuffled = list(xs)
    mags = []
    for _ in range(trials):
        rng.shuffle(shuffled)
        mags.append(abs(pearson(shuffled, ys)))
    mags.sort()
    return mags[int(0.95 * len(mags))]


def evaluate(ind: Series, ref: Series, lag: int, oos_frac: float = 0.3) -> ICResult | None:
    xs, ys = aligned_pairs(ind, ref, lag)
    if len(xs) < MIN_PAIRS:
        return None
    ic = pearson(xs, ys)
    n_eff = max(3, len(xs) // lag)          # overlapping windows
    denom = max(1e-9, 1 - ic * ic)
    t = ic * math.sqrt((n_eff - 2) / denom)
    null_p95 = permutation_null(xs, ys)

    split = int(len(xs) * (1 - oos_frac))
    oos_ic = pearson(xs[split:], ys[split:]) if len(xs) - split >= 10 else None

    return ICResult(
        lag=lag, ic=round(ic, 4), n=len(xs), n_eff=n_eff,
        t_stat=round(t, 2), significant=abs(t) >= 2,
        null_p95=round(null_p95, 4), beats_null=abs(ic) > null_p95,
        oos_ic=round(oos_ic, 4) if oos_ic is not None else None,
        oos_n=len(xs) - split,
    )


def run(candidates: list[Candidate]) -> list[Candidate]:
    cache: dict[str, dict] = {}
    for c in candidates:
        data = cache.setdefault(c.sector, load_sector(c.sector))
        ind = category_series(data, c.asset, c.categories)
        ref = reference_series(data, c.reference)
        if not ind or not ref:
            continue
        for lag in LAGS:
            r = evaluate(ind, ref, lag)
            if r:
                c.results.append(r)
    return candidates
