# Polymarket Sentiment Indicators (PMSI)

Real-time sentiment indicators built from Polymarket prediction markets across crypto, stocks, economy, and politics.

## What it does

PMSI aggregates probability data from thousands of Polymarket prediction markets and computes weighted sentiment scores. Users can build custom indicators by selecting specific markets, adjusting weights, inverting bearish markets, and backtesting strategies against reference assets like BTC, S&P 500, gold, or treasury yields.

## Features

- **Multi-sector coverage** — Crypto, stocks, economy, and politics markets
- **Custom indicator builder** — Select individual markets, adjust weights, flip polarity
- **16 reference assets** — Test indicators against BTC, ETH, SOL, S&P 500, Nasdaq, VIX, treasuries, gold, oil, and more
- **Backtest engine** — Momentum, contrarian, and long-only strategies with equity curve, Sharpe ratio, and alpha
- **Cross-sector mixing** — Combine markets from any sector into one indicator
- **Fear & Greed blending** — Optional sentiment signal overlay
- **API access** — Public REST API with API key authentication

## Stack

- **Pipeline:** Python (httpx, click) — Polymarket Gamma API, CoinGecko, Yahoo Finance, FRED
- **Database:** Postgres (production) / SQLite (dev)
- **Frontend:** Vanilla JS + Tailwind CSS + Chart.js
- **Hosting:** Vercel (static files + serverless functions)

## Quick start

```bash
# Install pipeline dependencies
cd pipeline
pip install -r requirements.txt

# Set up environment
cp .env.example .env  # Add DATABASE_URL, ANTHROPIC_API_KEY, FRED_API_KEY

# Run pipeline for a sector
python3 snapshot.py --sector crypto -v

# Export data for frontend
python3 export.py --sector crypto --out ../public/data -v

# Run dev server
cd ..
npx vercel dev
```

## Project structure

```
pipeline/       Data pipeline (discovery, classification, scoring, export)
public/         Static frontend (SPA)
api/            Vercel serverless API functions
```

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.
