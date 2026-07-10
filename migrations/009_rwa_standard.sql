-- ============================================================
-- Migration 009: RWA Standard Tier
-- Deliveries, Daily Help, Vehicles, Kids Checkout, Directory opt-in, Pre-approved visitors
-- Idempotent — safe to re-run
-- ============================================================

-- Deliveries
CREATE TABLE IF NOT EXISTS deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    security_id     UUID REFERENCES security_users(id) ON DELETE SET NULL,
    courier_name    TEXT,
    parcel_photo_url TEXT,
    status          TEXT NOT NULL DEFAULT 'arrived' CHECK (status IN ('arrived','collected','returned')),
    arrived_at      TIMESTAMPTZ DEFAULT now(),
    collected_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_resident  ON deliveries(resident_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_security  ON deliveries(security_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status    ON deliveries(status);

ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'deliveries' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON deliveries FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Daily help (maids, drivers, cooks etc.)
CREATE TABLE IF NOT EXISTS daily_help (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    mobile          TEXT,
    role_type       TEXT,
    photo_url       TEXT,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE daily_help ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'daily_help' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON daily_help FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS daily_help_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_help_id   UUID NOT NULL REFERENCES daily_help(id) ON DELETE CASCADE,
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dha_help     ON daily_help_assignments(daily_help_id);
CREATE INDEX IF NOT EXISTS idx_dha_resident ON daily_help_assignments(resident_id);

ALTER TABLE daily_help_assignments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'daily_help_assignments' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON daily_help_assignments FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS daily_help_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_help_id   UUID NOT NULL REFERENCES daily_help(id) ON DELETE CASCADE,
    check_in        TIMESTAMPTZ,
    check_out       TIMESTAMPTZ,
    verified_by     UUID REFERENCES security_users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dha_att_help ON daily_help_attendance(daily_help_id);
CREATE INDEX IF NOT EXISTS idx_dha_att_sec  ON daily_help_attendance(verified_by);

ALTER TABLE daily_help_attendance ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'daily_help_attendance' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON daily_help_attendance FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Resident-owned vehicles
CREATE TABLE IF NOT EXISTS resident_vehicles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    vehicle_number  TEXT NOT NULL,
    vehicle_type    TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_number)
);

CREATE INDEX IF NOT EXISTS idx_rv_resident ON resident_vehicles(resident_id);

ALTER TABLE resident_vehicles ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'resident_vehicles' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON resident_vehicles FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Kids checkout (reuses OTP pattern)
CREATE TABLE IF NOT EXISTS kids_checkout (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    child_name      TEXT NOT NULL,
    picked_up_by    TEXT NOT NULL,
    otp_code        TEXT,
    otp_verified_at TIMESTAMPTZ,
    security_id     UUID REFERENCES security_users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kids_resident ON kids_checkout(resident_id);

ALTER TABLE kids_checkout ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'kids_checkout' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON kids_checkout FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Add directory_opt_in to residents (additive ALTER)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'residents' AND column_name = 'directory_opt_in'
    ) THEN
        ALTER TABLE residents ADD COLUMN directory_opt_in BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add is_pre_approved to visitor_requests (additive ALTER — do not touch existing status CHECK)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'visitor_requests' AND column_name = 'is_pre_approved'
    ) THEN
        ALTER TABLE visitor_requests ADD COLUMN is_pre_approved BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
