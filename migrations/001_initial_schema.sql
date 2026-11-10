-- Migration 001: Initial Core Schema
-- Strict system engineering schema with check constraints, foreign keys and indexes.

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS urls (
    code VARCHAR(32) PRIMARY KEY,
    destination_url TEXT NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    CONSTRAINT code_not_empty CHECK (length(code) > 0),
    CONSTRAINT expiry_after_creation
        CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS urls_owner_created_idx
    ON urls (owner_id, created_at DESC)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS urls_expiry_idx
    ON urls (expires_at)
    WHERE expires_at IS NOT NULL AND disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    principal_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (principal_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idempotency_expiry_idx
    ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS url_stats (
    code VARCHAR(32) PRIMARY KEY REFERENCES urls(code) ON DELETE CASCADE,
    click_count BIGINT NOT NULL DEFAULT 0,
    last_clicked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS click_events (
    event_id UUID PRIMARY KEY,
    code VARCHAR(32) NOT NULL REFERENCES urls(code) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL,
    referrer_host TEXT,
    user_agent_family TEXT,
    country_code CHAR(2)
);

CREATE INDEX IF NOT EXISTS click_events_code_time_idx
    ON click_events (code, occurred_at DESC);

