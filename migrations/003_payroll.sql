-- ============================================================
-- Migration 003: Payroll
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. payroll: payment rows
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id        TEXT NOT NULL,
    subcontractor_id  TEXT,
    amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','unlocked','paid')),
    created_by        TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_venture ON payroll(venture_id);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll(status);

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
