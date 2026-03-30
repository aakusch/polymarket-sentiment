"""Sector definitions, scoring weights, and API constants."""

from __future__ import annotations

# ── API Endpoints ──────────────────────────────────────────────────────────

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"

GAMMA_SEARCH = f"{GAMMA_BASE}/public-search"
GAMMA_EVENTS = f"{GAMMA_BASE}/events"
GAMMA_MARKETS = f"{GAMMA_BASE}/markets"
CLOB_BOOK = f"{CLOB_BASE}/book"
CLOB_PRICES_HISTORY = f"{CLOB_BASE}/prices-history"

# Rate limiting (conservative — actual limits are ~500/10s gamma, ~1000/10s clob)
GAMMA_REQ_PER_SEC = 20
CLOB_REQ_PER_SEC = 40
REQUEST_TIMEOUT = 30.0

# ── Scoring Constants ─────────────────────────────────────────────────────

MAX_VOLUME = 50_000_000     # log-scaled normalization ceiling for 24h volume
MAX_LIQUIDITY = 10_000_000  # log-scaled normalization ceiling for liquidity
MAX_OI = 20_000_000         # log-scaled normalization ceiling for open interest

WEIGHT_VOLUME = 0.4
WEIGHT_LIQUIDITY = 0.3
WEIGHT_OI = 0.2
WEIGHT_TIME_DECAY = 0.1

TIME_DECAY_HORIZON_DAYS = 90  # Full weight at 90+ days to expiry

# ── Sector Definitions ────────────────────────────────────────────────────

SECTORS: dict[str, dict] = {
    "crypto": {
        "search_terms": [
            "bitcoin", "btc", "ethereum", "eth", "crypto",
            "solana", "sol", "xrp", "altcoin", "defi",
            "nft", "blockchain", "token", "cardano", "tether",
            "stablecoin", "memecoin", "web3",
        ],
        "tag_ids": [
            101528,   # altcoin
            101531,   # Strategic Bitcoin Reserve
            101612,   # Cardano
            102099,   # ETH/BTC
            102324,   # XRP Prices
            102328,   # Bitcoin Volatility
            869,      # tether
            1219,     # web3
            21,       # Crypto (main tag)
        ],
        "classification_rules": "CRYPTO_RULES",
    },
}

# ── Classification Keywords ───────────────────────────────────────────────

# Maps keyword patterns (applied to market question) to (signal_type, polarity)
KEYWORD_RULES: list[tuple[list[str], str, str]] = [
    # Price targets — bullish
    (["above", "reach", "hit", "exceed", "surpass", "rise to", "rise above",
      "close above", "end above", "higher than", "at least", "over"],
     "price_above", "bullish"),
    # Price targets — bearish
    (["below", "fall to", "fall below", "drop to", "drop below", "crash",
      "dip", "dip to", "dip below"],
     "price_below", "bearish"),
    # Price range — neutral (range markets, contributes weight but signal=0)
    (["between"],
     "price_range", "neutral"),
    # Regulatory — positive
    (["approve", "approval", "pass", "passes", "adopt", "legalize", "stablecoin bill"],
     "regulatory_positive", "bullish"),
    # Regulatory — negative
    (["ban", "prohibit", "sue", "sues", "sanction", "restrict", "crack down"],
     "regulatory_negative", "bearish"),
    # Adoption — bullish
    (["adopt", "integration", "launch", "users", "milestone", "partnership"],
     "adoption", "bullish"),
    # Events — positive
    (["etf approved", "etf approval", "halving", "upgrade", "mainnet"],
     "event_positive", "bullish"),
    # Events — negative
    (["hack", "exploit", "collapse", "insolvency", "bankruptcy", "rug pull",
      "sell", "sells", "dump"],
     "event_negative", "bearish"),
]

# ── Asset Patterns ───────────────────────────────────────────────────────

ASSET_PATTERNS: dict[str, str] = {
    "BTC": r"\b(bitcoin|btc)\b",
    "ETH": r"\b(ethereum|eth|ether)\b",
    "SOL": r"\b(solana|sol)\b",
    "XRP": r"\b(xrp|ripple)\b",
    "ADA": r"\b(cardano|ada)\b",
    "DOGE": r"\b(dogecoin|doge)\b",
    "AVAX": r"\b(avalanche|avax)\b",
    "DOT": r"\b(polkadot|dot)\b",
    "LINK": r"\b(chainlink|link)\b",
    "MATIC": r"\b(polygon|matic)\b",
    "UNI": r"\b(uniswap|uni)\b",
    "LTC": r"\b(litecoin|ltc)\b",
    "ATOM": r"\b(cosmos|atom)\b",
    "NEAR": r"\b(near protocol|near)\b",
    "SUI": r"\b(sui)\b",
}

# ── Noise Filtering ──────────────────────────────────────────────────────

# Regex pattern for short-duration binary option noise markets
NOISE_TITLE_PATTERN = r"Up or Down"
NOISE_MAX_DURATION_HOURS = 24  # Exclude events shorter than this

# ── Database ──────────────────────────────────────────────────────────────

DB_PATH = "polymarket_sentiment.db"

# ── Backfill ──────────────────────────────────────────────────────────────

BACKFILL_FIDELITY = 1440  # Daily candles (minutes)
BACKFILL_INTERVAL = "max"
