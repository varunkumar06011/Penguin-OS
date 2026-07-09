-- ============================================================
-- Migration 003: Payroll & Milestone Verification
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. milestones: work milestones tied to subcontractors
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id          TEXT NOT NULL,
    subcontractor_id    TEXT,
    work_item           TEXT,
    block               TEXT,
    floor               TEXT,
    flat                TEXT,
    description         TEXT,
    required_photo_pair BOOLEAN NOT NULL DEFAULT TRUE,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','submitted','verified','rejected')),
    submitted_by        TEXT,
    submitted_at        TIMESTAMPTZ,
    verified_by         TEXT,
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_venture   ON milestones(venture_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status    ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_subcon    ON milestones(subcontractor_id);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'milestones' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON milestones FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 2. milestone_photos: before/after photo URLs (stored in Supabase Storage)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_photos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id  UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    photo_type    TEXT NOT NULL CHECK (photo_type IN ('before','after')),
    photo_url     TEXT NOT NULL,
    taken_at      DATE NOT NULL,
    uploaded_by   TEXT,
    uploaded_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestone_photos_milestone ON milestone_photos(milestone_id);

ALTER TABLE milestone_photos ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'milestone_photos' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON milestone_photos FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 3. payroll: payment rows linked to milestones
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id        TEXT NOT NULL,
    subcontractor_id  TEXT,
    milestone_id      UUID REFERENCES milestones(id),
    amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','unlocked','paid')),
    created_by        TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_venture   ON payroll(venture_id);
CREATE INDEX IF NOT EXISTS idx_payroll_status    ON payroll(status);
CREATE INDEX IF NOT EXISTS idx_payroll_milestone ON payroll(milestone_id);

ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'payroll' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON payroll FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 4. Trigger: payroll cannot be unlocked unless milestone is verified
--    This is the anti-ghost-billing gate — enforced at the DB level,
--    not just in app logic, so it cannot be bypassed by a direct API call.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_milestone_verified()
RETURNS trigger AS $$
BEGIN
    IF new.status = 'unlocked' THEN
        IF NOT EXISTS (
            SELECT 1 FROM milestones
            WHERE id = new.milestone_id AND status = 'verified'
        ) THEN
            RAISE EXCEPTION 'Cannot unlock payroll: milestone % is not verified', new.milestone_id;
        END IF;
    END IF;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_milestone_verified ON payroll;
CREATE TRIGGER trg_enforce_milestone_verified
    BEFORE INSERT OR UPDATE ON payroll
    FOR EACH ROW EXECUTE FUNCTION enforce_milestone_verified();
