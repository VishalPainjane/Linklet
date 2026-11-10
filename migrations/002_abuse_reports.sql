-- Migration 002: Abuse Reports & Security Audit Table
-- Supports abuse handling and administrative revocation of malicious links.

CREATE TABLE IF NOT EXISTS abuse_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL REFERENCES urls(code) ON DELETE CASCADE,
    reason VARCHAR(32) NOT NULL,
    comment TEXT,
    reporter_ip TEXT,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abuse_reports_code_idx
    ON abuse_reports (code, reported_at DESC);
