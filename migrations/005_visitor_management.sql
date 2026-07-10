-- ============================================================
-- Migration 005: Visitor Management & OTP System
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- Residents (can also be users of the main app)
CREATE TABLE IF NOT EXISTS residents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    mobile      TEXT UNIQUE NOT NULL,
    block       TEXT NOT NULL,
    floor       TEXT NOT NULL,
    flat        TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_residents_mobile ON residents(mobile);
CREATE INDEX IF NOT EXISTS idx_residents_active ON residents(active);

ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'residents' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON residents FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Security guard accounts
CREATE TABLE IF NOT EXISTS security_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'security' CHECK (role IN ('security')),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_users_email ON security_users(email);

ALTER TABLE security_users ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'security_users' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON security_users FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Visitor requests / entries
CREATE TABLE IF NOT EXISTS visitor_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id         UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    security_id         UUID REFERENCES security_users(id) ON DELETE SET NULL,
    visitor_name        TEXT NOT NULL,
    visitor_mobile      TEXT,
    purpose             TEXT,
    visitor_count       INTEGER NOT NULL DEFAULT 1,
    vehicle_number      TEXT,
    id_proof_type       TEXT,
    remarks             TEXT,
    status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','approved','rejected','inside','completed')),
    otp_code            TEXT,
    otp_verified_at     TIMESTAMPTZ,
    entry_time          TIMESTAMPTZ,
    exit_time           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_requests_resident  ON visitor_requests(resident_id);
CREATE INDEX IF NOT EXISTS idx_visitor_requests_security  ON visitor_requests(security_id);
CREATE INDEX IF NOT EXISTS idx_visitor_requests_status    ON visitor_requests(status);
CREATE INDEX IF NOT EXISTS idx_visitor_requests_created   ON visitor_requests(created_at);

ALTER TABLE visitor_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'visitor_requests' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON visitor_requests FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- OTP audit log
CREATE TABLE IF NOT EXISTS otp_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id      UUID REFERENCES visitor_requests(id) ON DELETE CASCADE,
    mobile          TEXT NOT NULL,
    otp_code        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','expired')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    verified_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_otp_log_visitor ON otp_log(visitor_id);
CREATE INDEX IF NOT EXISTS idx_otp_log_mobile  ON otp_log(mobile);

ALTER TABLE otp_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'otp_log' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON otp_log FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_visitor_requests_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = now();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_visitor_requests_updated_at ON visitor_requests;
CREATE TRIGGER trg_update_visitor_requests_updated_at
    BEFORE UPDATE ON visitor_requests
    FOR EACH ROW EXECUTE FUNCTION update_visitor_requests_updated_at();
