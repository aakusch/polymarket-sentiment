-- PMSI Platform schema — users, indicators, API keys, usage, payments

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    password_hash TEXT,
    wallet_address TEXT UNIQUE,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indicators (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sector TEXT NOT NULL DEFAULT 'crypto',
    asset TEXT NOT NULL DEFAULT 'BTC',
    weights JSONB NOT NULL,
    fg_enabled BOOLEAN DEFAULT false,
    fg_weight INTEGER DEFAULT 30,
    include_other BOOLEAN DEFAULT false,
    is_public BOOLEAN DEFAULT true,
    price_per_100 NUMERIC(12,6),
    price_token TEXT DEFAULT 'SOL',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    label TEXT,
    credits_remaining INTEGER DEFAULT 0,
    rate_limit_per_min INTEGER DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_usage (
    id BIGSERIAL PRIMARY KEY,
    api_key_id UUID NOT NULL REFERENCES api_keys(id),
    indicator_id TEXT NOT NULL REFERENCES indicators(id),
    endpoint TEXT NOT NULL,
    called_at TIMESTAMPTZ DEFAULT now(),
    response_ms INTEGER
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id UUID NOT NULL REFERENCES users(id),
    indicator_id TEXT NOT NULL REFERENCES indicators(id),
    tx_signature TEXT NOT NULL UNIQUE,
    amount NUMERIC(18,9) NOT NULL,
    token TEXT DEFAULT 'SOL',
    credits_purchased INTEGER NOT NULL,
    creator_amount NUMERIC(18,9) NOT NULL,
    platform_amount NUMERIC(18,9) NOT NULL,
    creator_wallet TEXT NOT NULL,
    platform_wallet TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
