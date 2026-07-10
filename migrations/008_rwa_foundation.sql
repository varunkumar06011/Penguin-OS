-- ============================================================
-- Migration 008: RWA Foundation — flats master + emergency contacts
-- Idempotent — safe to re-run
-- ============================================================

-- Flats master table (decoupled from residents — a flat can have
-- 0 or 1+ residents over time: owner vs tenant)
CREATE TABLE IF NOT EXISTS flats (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block                 TEXT NOT NULL,
    floor                 TEXT NOT NULL,
    flat_number           TEXT NOT NULL,
    owner_name            TEXT,
    owner_mobile          TEXT,
    possession_date       DATE,
    construction_status   TEXT NOT NULL DEFAULT 'pending'
                          CHECK (construction_status IN ('pending','handover_ready','completed')),
    created_at            TIMESTAMPTZ DEFAULT now(),
    UNIQUE (block, floor, flat_number)
);

CREATE INDEX IF NOT EXISTS idx_flats_block      ON flats(block);
CREATE INDEX IF NOT EXISTS idx_flats_floor      ON flats(floor);
CREATE INDEX IF NOT EXISTS idx_flats_status     ON flats(construction_status);
CREATE INDEX IF NOT EXISTS idx_flats_unique     ON flats(block, floor, flat_number);

ALTER TABLE flats ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'flats' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON flats FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Add flats.id as nullable FK on residents (keep existing block/floor/flat text columns)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'residents' AND column_name = 'flat_id'
    ) THEN
        ALTER TABLE residents ADD COLUMN flat_id UUID REFERENCES flats(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_residents_flat_id ON residents(flat_id);

-- Emergency contacts
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label           TEXT NOT NULL,
    phone_number    TEXT NOT NULL,
    category        TEXT,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'emergency_contacts' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON emergency_contacts FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Seed emergency contacts (idempotent)
INSERT INTO emergency_contacts (label, phone_number, category, active)
VALUES
    ('RWA Office',     '9000000001', 'office',    TRUE),
    ('Watchman',       '9000000002', 'security',  TRUE),
    ('Ambulance',      '108',        'medical',   TRUE),
    ('Fire Station',   '101',        'fire',      TRUE),
    ('Police Station', '100',        'police',    TRUE)
ON CONFLICT DO NOTHING;
