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
REQUEST_TIMEOUT = 60.0

# ── Scoring Constants ─────────────────────────────────────────────────────

MAX_VOLUME = 50_000_000     # log-scaled normalization ceiling for 24h volume
MAX_LIQUIDITY = 10_000_000  # log-scaled normalization ceiling for liquidity
MAX_OI = 20_000_000         # log-scaled normalization ceiling for open interest

# Coverage floor for publishing a composite. A directional score built from a
# handful of markets out of a thousand is not a sector reading — politics scored
# 86.0 off 5 of 1,117 markets once unclassified markets stopped padding the
# denominator. Below either floor the score is still computed and stored, but it
# is flagged so the surface can label it instead of presenting it as measured.
MIN_CLASSIFIED_PCT = 20.0
MIN_SCORED_MARKETS = 25

RESOLVED_PROB_LOW = 0.02    # Markets below this are effectively settled → skip
RESOLVED_PROB_HIGH = 0.98   # Markets above this are effectively settled → skip

SIGNAL_COMPRESSION_K = 3.0  # tanh steepness: higher = more sensitivity near 0.5

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
    "stocks": {
        "search_terms": [
            "S&P 500", "stock market", "NASDAQ", "Tesla stock",
            "NVIDIA", "earnings", "market crash", "dow jones", "IPO",
            "Apple stock", "Microsoft stock", "Amazon stock",
        ],
        "tag_ids": [],
        "classification_rules": "STOCK_RULES",
    },
    "economy": {
        "search_terms": [
            "inflation", "Federal Reserve", "interest rate", "GDP",
            "unemployment", "recession", "CPI", "tariff",
            "treasury", "jobs report", "economic growth",
        ],
        "tag_ids": [],
        "classification_rules": "ECONOMY_RULES",
    },
    "politics": {
        "search_terms": [
            "Trump", "2026 election", "Senate", "Congress",
            "House majority", "Supreme Court", "midterm",
            "Democrat", "Republican", "presidential",
        ],
        "tag_ids": [],
        "classification_rules": "POLITICS_RULES",
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

    # ── Stocks keyword rules ──────────────────────────────────────────────
    # Earnings
    (["beat earnings", "earnings beat", "earnings surprise", "revenue beat"],
     "earnings_positive", "bullish"),
    (["miss earnings", "earnings miss", "revenue miss", "profit warning"],
     "earnings_negative", "bearish"),
    # Corporate
    (["merger", "acquisition", "buyback", "dividend increase", "stock split"],
     "corporate_positive", "bullish"),
    (["layoff", "downgrade", "delisted", "sec investigation", "recall"],
     "corporate_negative", "bearish"),

    # ── Economy keyword rules ─────────────────────────────────────────────
    # Monetary policy
    (["rate cut", "cut rates", "dovish", "pause rate", "easing"],
     "monetary_dovish", "bullish"),
    (["rate hike", "raise rates", "hawkish", "tightening", "restrictive"],
     "monetary_hawkish", "bearish"),
    # Inflation
    (["inflation rise", "cpi increase", "inflation above", "price increase"],
     "inflation_rising", "bearish"),
    (["inflation fall", "cpi decrease", "inflation below", "disinflation"],
     "inflation_falling", "bullish"),
    # Growth
    (["gdp growth", "economic growth", "expansion", "soft landing"],
     "growth_positive", "bullish"),
    (["recession", "contraction", "hard landing", "gdp decline", "slowdown"],
     "growth_negative", "bearish"),
    # Employment
    (["jobs added", "unemployment fall", "unemployment below", "hiring"],
     "employment_positive", "bullish"),
    (["job losses", "unemployment rise", "unemployment above", "layoffs"],
     "employment_negative", "bearish"),

    # ── Politics keyword rules ────────────────────────────────────────────
    (["reelected", "wins", "incumbent wins", "approval rating above"],
     "favors_incumbent", "bullish"),
    (["challenger wins", "upset", "loses seat", "approval rating below"],
     "favors_challenger", "bearish"),
    (["bill passes", "legislation signed", "bipartisan", "enacted"],
     "legislative_positive", "bullish"),
    (["bill fails", "vetoed", "filibuster", "gridlock", "government shutdown"],
     "legislative_negative", "bearish"),
    (["war", "conflict", "sanctions imposed", "diplomatic crisis", "invasion"],
     "geopolitical_event", "bearish"),
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

# Stock / macro asset patterns (used for stocks & economy sectors)
STOCK_ASSET_PATTERNS: dict[str, str] = {
    "SPX": r"\b(s&p|spx|sp500|s&p 500)\b",
    "NDX": r"\b(nasdaq|ndx|nasdaq.100)\b",
    "TSLA": r"\b(tesla|tsla)\b",
    "NVDA": r"\b(nvidia|nvda)\b",
    "AAPL": r"\b(apple|aapl)\b",
    "MSFT": r"\b(microsoft|msft)\b",
    "AMZN": r"\b(amazon|amzn)\b",
    "DJI": r"\b(dow jones|dow|djia)\b",
    "VIX": r"\b(vix|volatility index)\b",
    "RATES": r"\b(interest rate|fed funds|federal funds)\b",
    "YIELD": r"\b(treasury|10.year|bond yield)\b",
    "CPI": r"\b(cpi|consumer price)\b",
    "GDP": r"\b(gdp|gross domestic)\b",
    "JOBS": r"\b(unemployment|jobs report|nonfarm|payroll)\b",
}

# ── Noise Filtering ──────────────────────────────────────────────────────

# Regex pattern for short-duration binary option noise markets
NOISE_TITLE_PATTERN = r"Up or Down"
NOISE_MAX_DURATION_HOURS = 24  # Exclude events shorter than this

# Question-level noise patterns (applied in scorer, not just discovery)
NOISE_QUESTION_PATTERNS = [r"(?i)\bup or down\b"]

# ── Database ──────────────────────────────────────────────────────────────

DB_PATH = "polymarket_sentiment.db"

# ── Backfill ──────────────────────────────────────────────────────────────

BACKFILL_FIDELITY = 1440  # Daily candles (minutes)
BACKFILL_INTERVAL = "max"


# ── Sector-scoped classification rules ────────────────────────────────────
#
# KEYWORD_RULES above is the historical flat list: every rule applied to every
# sector, first substring match wins. That produced sign errors the composite
# cannot recover from — "inflation above 3%" matched the bullish price-target
# rule (which contains "above") and scored as bullish for MACRO, and because
# that rule sits first, the purpose-built "inflation above"/"unemployment above"
# rules below were unreachable. Splitting by sector is what SECTORS already
# promised with its `classification_rules` names.
#
# Rules are matched on word boundaries and the LONGEST matching keyword wins, so
# "inflation above" beats "above" regardless of list order. See classifier.py.

_PRICE_RULES: list[tuple[list[str], str, str]] = [
    (["above", "reach", "hit", "exceed", "surpass", "rise to", "rise above",
      "close above", "end above", "higher than", "at least", "over"],
     "price_above", "bullish"),
    (["below", "fall to", "fall below", "drop to", "drop below", "crash",
      "dip", "dip to", "dip below"],
     "price_below", "bearish"),
    (["between"], "price_range", "neutral"),
]

CRYPTO_RULES: list[tuple[list[str], str, str]] = _PRICE_RULES + [
    (["approve", "approval", "pass", "passes", "legalize", "stablecoin bill"],
     "regulatory_positive", "bullish"),
    (["ban", "prohibit", "sue", "sues", "sanction", "restrict", "crack down"],
     "regulatory_negative", "bearish"),
    (["adopt", "adoption", "integration", "launch", "milestone", "partnership"],
     "adoption", "bullish"),
    (["etf approved", "etf approval", "halving", "upgrade", "mainnet"],
     "event_positive", "bullish"),
    (["hack", "exploit", "collapse", "insolvency", "bankruptcy", "rug pull",
      "dump"],
     "event_negative", "bearish"),
]

STOCK_RULES: list[tuple[list[str], str, str]] = _PRICE_RULES + [
    (["beat earnings", "earnings beat", "earnings surprise", "revenue beat"],
     "earnings_positive", "bullish"),
    (["miss earnings", "earnings miss", "revenue miss", "profit warning"],
     "earnings_negative", "bearish"),
    (["merger", "acquisition", "buyback", "dividend increase", "stock split"],
     "corporate_positive", "bullish"),
    (["layoff", "layoffs", "downgrade", "delisted", "sec investigation", "recall"],
     "corporate_negative", "bearish"),
]

# No price rules: in this sector "above"/"below" are almost always about a
# macro series (CPI, unemployment), where direction is the opposite of a price
# target — a higher print is bearish for risk assets.
ECONOMY_RULES: list[tuple[list[str], str, str]] = [
    (["rate cut", "cut rates", "dovish", "pause rate", "easing"],
     "monetary_dovish", "bullish"),
    (["rate hike", "raise rates", "hawkish", "tightening", "restrictive"],
     "monetary_hawkish", "bearish"),
    (["inflation rise", "inflation rises", "cpi increase", "inflation above",
      "cpi above", "price increase", "reaccelerate"],
     "inflation_rising", "bearish"),
    (["inflation fall", "inflation falls", "cpi decrease", "inflation below",
      "cpi below", "disinflation"],
     "inflation_falling", "bullish"),
    (["gdp growth", "economic growth", "expansion", "soft landing"],
     "growth_positive", "bullish"),
    (["recession", "contraction", "hard landing", "gdp decline", "slowdown"],
     "growth_negative", "bearish"),
    (["jobs added", "unemployment fall", "unemployment falls",
      "unemployment below", "hiring"],
     "employment_positive", "bullish"),
    (["job losses", "unemployment rise", "unemployment rises",
      "unemployment above", "layoffs", "jobless claims above"],
     "employment_negative", "bearish"),
]

POLITICS_RULES: list[tuple[list[str], str, str]] = [
    (["reelected", "re-elected", "incumbent wins", "approval rating above"],
     "favors_incumbent", "bullish"),
    (["challenger wins", "upset", "loses seat", "approval rating below"],
     "favors_challenger", "bearish"),
    (["bill passes", "legislation signed", "bipartisan", "enacted",
      "confirmed by the senate"],
     "legislative_positive", "bullish"),
    (["bill fails", "vetoed", "filibuster", "gridlock", "government shutdown",
      "government shut down", "shutdown"],
     "legislative_negative", "bearish"),
    # Escalation and de-escalation are opposite signals. The original taxonomy
    # had one bearish "geopolitical_event" bucket holding both "invasion" and
    # "ceasefire", so a peace deal scored as risk-off.
    (["war", "conflict", "sanctions imposed", "diplomatic crisis", "invasion",
      "invade", "invades", "military strike", "escalation"],
     "geopolitical_event", "bearish"),
    (["ceasefire", "peace deal", "peace agreement", "truce", "de-escalation",
      "sanctions lifted"],
     "geopolitical_deescalation", "bullish"),
]

SECTOR_RULES: dict[str, list[tuple[list[str], str, str]]] = {
    "crypto": CRYPTO_RULES,
    "stocks": STOCK_RULES,
    "economy": ECONOMY_RULES,
    "politics": POLITICS_RULES,
}

# ── Sector membership ─────────────────────────────────────────────────────
#
# Discovery's primary source is a bulk fetch of every active event by volume,
# and search/tag results only ever ADD to it — nothing subtracted, so all four
# sectors scored the same ~1,750-market universe. Membership has to be a
# positive decision. Polymarket tags are the reliable signal (the bulk feed is
# mostly sports/esports); question patterns are the fallback for untagged events.

SECTOR_TAG_LABELS: dict[str, set[str]] = {
    "crypto": {
        "crypto", "bitcoin", "ethereum", "solana", "altcoin", "web3", "defi",
        "nft", "memecoin", "stablecoin", "tether", "cardano", "xrp", "ripple",
        "dogecoin", "crypto prices", "bitcoin volatility", "eth/btc",
    },
    # Deliberately narrow: "business" and "tech" also sit on macro events like
    # "How many Fed rate cuts in 2026?", which is not an equities market.
    "stocks": {
        "stocks", "stock market", "earnings", "ipo", "nasdaq", "s&p 500",
        "sp500", "dow jones", "tesla", "nvidia", "apple", "microsoft",
        "publicly traded", "stock prices",
    },
    "economy": {
        "economic policy", "economy", "fed", "fed rates", "fomc", "inflation",
        "cpi", "macro", "recession", "interest rates", "jobs", "tariffs",
        "jerome powell", "treasury",
    },
    "politics": {
        "politics", "elections", "us election", "world elections",
        "global elections", "geopolitics", "congress", "supreme court",
        "white house", "us politics", "foreign policy", "main election",
    },
}

# Tags that disqualify an event from every sector. The bulk volume feed is
# dominated by these, and a sports market has no business weighting a
# macroeconomic indicator no matter what its question happens to say.
EXCLUDED_TAG_LABELS: set[str] = {
    "sports", "esports", "games", "soccer", "mlb", "nba", "nfl", "nhl",
    "league of legends", "baseball", "basketball", "football", "tennis",
    "golf", "cricket", "ufc", "boxing", "f1", "olympics", "chess",
    "pop culture", "celebrities", "movies", "music", "awards", "weather",
}

# Fallback for events carrying no usable tag. Word-boundary regexes on the
# event title / market question.
SECTOR_QUESTION_PATTERNS: dict[str, list[str]] = {
    "crypto": [
        r"\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|ripple|cardano|ada|dogecoin|doge)\b",
        r"\b(crypto|cryptocurrency|altcoin|stablecoin|defi|nft|blockchain|memecoin|web3)\b",
    ],
    "stocks": [
        r"\b(s&p ?500|spx|nasdaq|dow jones|russell 2000)\b",
        r"\b(stock|stocks|share price|earnings|ipo|buyback|dividend)\b",
        r"\b(tesla|nvidia|apple|microsoft|amazon|meta|alphabet|google)\b",
    ],
    "economy": [
        r"\b(inflation|cpi|pce|gdp|unemployment|jobless|payrolls|recession)\b",
        r"\b(fed|federal reserve|fomc|interest rate|rate cut|rate hike|powell)\b",
        r"\b(tariff|tariffs|treasury yield|debt ceiling)\b",
    ],
    "politics": [
        r"\b(election|elections|primary|midterm|senate|congress|house majority)\b",
        r"\b(president|presidential|nominee|impeach|supreme court|shutdown)\b",
        r"\b(war|ceasefire|invasion|sanctions|nato|geopolitical)\b",
    ],
}
