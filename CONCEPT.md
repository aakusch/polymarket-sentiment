# PMSI — Concept & Logic

## The Concept

Prediction markets are one of the best real-time gauges of collective belief. When thousands of people put money on whether Bitcoin will hit $100K, whether the Fed will cut rates, or whether a candidate will win an election, the resulting probabilities encode genuine conviction — not just opinion polls or analyst forecasts, but skin-in-the-game estimates of what will actually happen.

PMSI turns this into a usable signal. It ingests probability data from Polymarket's public markets, classifies each market by sector and category, and lets users compose custom sentiment indicators by selecting, weighting, and combining individual markets. The output is a 0-100 sentiment score that tracks how bullish or bearish the collective prediction market is on a given theme — and that score can be overlaid against real asset prices to see if the crowd is actually predictive.

The key insight: a single prediction market is noisy, but a weighted composite of many related markets smooths out the noise and produces a signal with measurable correlation to actual price movements. By letting users pick which markets matter, adjust their influence, and flip the polarity of bearish markets, PMSI turns raw prediction data into a structured, backtestable sentiment indicator.

**Who it's for:** Crypto traders looking for non-price signals, macro analysts tracking policy sentiment, researchers studying prediction market efficiency, or anyone who wants to quantify "what does the crowd think?" and test whether it's worth listening to.

**What makes it different:** Most sentiment tools use social media volume or survey data. PMSI uses prediction market probabilities — real money, real stakes, real-time updates — across 4 sectors with 16 reference assets for backtesting.

---

## The Logic: Worked Example

### Setup

Say we want to build a BTC sentiment indicator. We pick 3 markets from Polymarket:

| Market | Question | Latest Prob | Category |
|--------|----------|-------------|----------|
| A | "Will BTC reach $100K by Dec 2026?" | 72% | price_targets |
| B | "Will BTC dip to $65K by Dec 2026?" | 31% | price_targets |
| C | "Will MicroStrategy sell any BTC by Dec 2026?" | 8% | events |

### Step 1: Sentiment Signal

Each market's probability is converted to a sentiment signal on a -1 to +1 scale. For most markets, higher probability = more bullish, so the signal is simply:

```
sentiment_signal = (probability * 2) - 1
```

- Market A (72% prob): signal = (0.72 * 2) - 1 = **+0.44**
- Market B (31% prob): signal = (0.31 * 2) - 1 = **-0.38**
- Market C (8% prob):  signal = (0.08 * 2) - 1 = **-0.84**

### Step 2: Polarity Flip

Market B asks about a *dip* — a higher probability means BTC is more likely to fall, which is bearish. We flip its polarity so the signal aligns with price direction:

```
flipped_signal = signal * -1
```

- Market B flipped: -0.38 * -1 = **+0.38** (31% dip chance → mildly bullish)

Same for Market C — MicroStrategy selling is bearish, so we flip:

- Market C flipped: -0.84 * -1 = **+0.84** (only 8% sell chance → very bullish)

### Step 3: Weighted Average

Each market gets a user-assigned weight (0-200%) and a volume-based weight from Polymarket. The composite score is:

```
raw_score = sum(user_weight * flip * signal * volume_weight) / sum(user_weight * volume_weight)
```

With user weights of 120% for A, 80% for B (flipped), and 50% for C (flipped), and assuming equal volume weights of 1.0:

```
numerator   = (1.2 * +0.44 * 1.0) + (0.8 * +0.38 * 1.0) + (0.5 * +0.84 * 1.0)
            = 0.528 + 0.304 + 0.42
            = 1.252

denominator = (1.2 * 1.0) + (0.8 * 1.0) + (0.5 * 1.0)
            = 2.5

raw_score   = 1.252 / 2.5 = 0.5008
```

### Step 4: Normalize to 0-100

```
final_score = (raw_score + 1) * 50 = (0.5008 + 1) * 50 = 75.0
```

**Result: 75.0 / 100 — Bullish**

This score is computed daily for every date where market snapshot data exists, producing a timeseries that can be charted alongside BTC's actual price.

### Step 5: Backtest

The backtest engine tests whether trading on this signal would have been profitable. Three strategies are available:

- **Momentum**: Enter when score > 60 (high conviction), exit when score < 40
- **Contrarian**: Enter when score < 35 (buy the dip), exit when score > 65
- **Long Only**: Enter when score < 40 (buy cheap), hold until score > 55

Each strategy tracks an equity curve, computes a Sharpe ratio, and compares returns against a simple buy-and-hold benchmark.

### Real Result

The BTC Price Tracker indicator shipped with PMSI uses 10 markets (6 price targets, 3 flipped dip/sell markets, 1 event market) and achieves a **+0.976 correlation** with BTC price over 134 daily data points — meaning the composite prediction market signal tracks actual price movement almost perfectly.
