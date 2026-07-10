-- ============================================================
-- Migration 004: Supervisor Expenditure Tracking
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. expenditures: site expenses submitted by supervisors,
--    visible to managers and admins for review.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenditures (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id  TEXT NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenditures_venture ON expenditures(venture_id);
CREATE INDEX IF NOT EXISTS idx_expenditures_created_at ON expenditures(created_at);

ALTER TABLE expenditures ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'expenditures' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON expenditures FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_expenditures_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = now();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_expenditures_updated_at ON expenditures;
CREATE TRIGGER trg_update_expenditures_updated_at
    BEFORE UPDATE ON expenditures
    FOR EACH ROW EXECUTE FUNCTION update_expenditures_updated_at();
