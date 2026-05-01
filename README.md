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
- **Database:** Postgres/Neon for shared API data; SQLite is only a local pipeline fallback
- **Frontend:** Vanilla JS + Tailwind CSS + Chart.js
- **Hosting:** Vercel (static files + serverless functions)

## Quick start

```bash
# Install dependencies
npm install
pip install -r pipeline/requirements.txt

# Set up local env for Vercel API routes and pipeline scripts
cp .env.example .env.local
# Add DATABASE_URL, JWT_SECRET, and any optional provider keys.

# Initialize Postgres schema
npm run setup:db
npm run seed:demo

# Run pipeline for a sector
cd pipeline
python3 snapshot.py --sector crypto -v

# Export data for frontend
python3 export.py --sector crypto --out ../public/data -v

# Run dev server
cd ..
npx vercel dev
```

Without `DATABASE_URL`, the local app can still serve committed static JSON, but DB-backed routes
such as public indicators, comments, views, auth, and API keys will return a database configuration
error.

## Production setup

1. Create a Neon/Postgres database.
2. Add these Vercel environment variables for Production, Preview, and Development as needed:

```bash
DATABASE_URL=...
JWT_SECRET=...
PLATFORM_WALLET=...
SOLANA_RPC_URL=...
```

3. Add these GitHub Actions secrets so the scheduled snapshot job can refresh the DB and committed JSON:

```bash
DATABASE_URL=...
FRED_API_KEY=...
ANTHROPIC_API_KEY=...
RESEND_API_KEY=...
ALERT_FROM_EMAIL=...
```

4. Pull Vercel env locally when you need parity:

```bash
vercel env pull .env.local
```

5. Initialize the database and demo indicators:

```bash
npm run setup:db
npm run seed:demo
```

6. Trigger the `Daily Snapshot` GitHub Action once. It runs all sectors, exports
`public/data/*.json`, validates the files, updates public indicator scores, commits the refreshed
data, and Vercel redeploys from Git.

## Project structure

```
pipeline/       Data pipeline (discovery, classification, scoring, export)
public/         Static frontend (SPA)
api/            Vercel serverless API functions
```

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.
