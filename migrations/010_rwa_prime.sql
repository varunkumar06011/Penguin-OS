-- ============================================================
-- Migration 010: RWA Prime Tier
-- Complaints, Amenities, Notices, Home Planner, Parking, SOS
-- Idempotent — safe to re-run
-- ============================================================

-- Complaints
CREATE TABLE IF NOT EXISTS complaints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    category        TEXT,
    description     TEXT NOT NULL,
    photo_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
    assigned_to     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_resident ON complaints(resident_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status   ON complaints(status);

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'complaints' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON complaints FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Amenities
CREATE TABLE IF NOT EXISTS amenities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'amenities' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON amenities FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS amenity_bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amenity_id      UUID NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    booking_date    DATE NOT NULL,
    slot            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (amenity_id, booking_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_ab_amenity   ON amenity_bookings(amenity_id);
CREATE INDEX IF NOT EXISTS idx_ab_resident  ON amenity_bookings(resident_id);
CREATE INDEX IF NOT EXISTS idx_ab_date      ON amenity_bookings(booking_date);

ALTER TABLE amenity_bookings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'amenity_bookings' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON amenity_bookings FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Notices
CREATE TABLE IF NOT EXISTS notices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    target_scope    TEXT NOT NULL DEFAULT 'all',
    target_value    TEXT,
    posted_by       TEXT,
    pinned          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notices_created ON notices(created_at);

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'notices' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON notices FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Home Planner
CREATE TABLE IF NOT EXISTS home_planner_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    due_date        DATE,
    done            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hpt_resident ON home_planner_tasks(resident_id);

ALTER TABLE home_planner_tasks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'home_planner_tasks' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON home_planner_tasks FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Parking
CREATE TABLE IF NOT EXISTS parking_slots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_number         TEXT NOT NULL UNIQUE,
    owner_resident_id   UUID REFERENCES residents(id),
    status              TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned','available_for_rent','rented')),
    created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE parking_slots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'parking_slots' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON parking_slots FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS parking_rentals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id             UUID NOT NULL REFERENCES parking_slots(id) ON DELETE CASCADE,
    renter_resident_id  UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    start_date          DATE NOT NULL,
    end_date            DATE,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_slot    ON parking_rentals(slot_id);
CREATE INDEX IF NOT EXISTS idx_pr_renter  ON parking_rentals(renter_resident_id);

ALTER TABLE parking_rentals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'parking_rentals' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON parking_rentals FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- SOS Alerts
CREATE TABLE IF NOT EXISTS sos_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id     UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    triggered_at    TIMESTAMPTZ DEFAULT now(),
    acknowledged_by UUID REFERENCES security_users(id),
    acknowledged_at TIMESTAMPTZ,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sos_resident ON sos_alerts(resident_id);
CREATE INDEX IF NOT EXISTS idx_sos_acked    ON sos_alerts(acknowledged_at);

ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'sos_alerts' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON sos_alerts FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- e-Intercom call requests (v1: ping, not WebRTC)
CREATE TABLE IF NOT EXISTS intercom_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id       UUID NOT NULL,
    caller_type     TEXT NOT NULL CHECK (caller_type IN ('resident','security')),
    target_type     TEXT NOT NULL CHECK (target_type IN ('resident','security','gate')),
    target_id       UUID,
    status          TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','answered','missed','cancelled')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    answered_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_intercom_caller ON intercom_calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_intercom_status ON intercom_calls(status);

ALTER TABLE intercom_calls ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'intercom_calls' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON intercom_calls FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
