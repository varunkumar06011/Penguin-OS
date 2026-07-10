-- ============================================================
-- Migration 007: Remove Milestone feature (cleanup for existing DBs)
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- Drop the payroll milestone-verification trigger and function
DROP TRIGGER IF EXISTS trg_enforce_milestone_verified ON payroll;
DROP FUNCTION IF EXISTS enforce_milestone_verified();

-- Drop milestone photo table (references milestones)
DROP TABLE IF EXISTS milestone_photos;

-- Drop milestones table
DROP TABLE IF EXISTS milestones;

-- Remove milestone_id column from payroll if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payroll' AND column_name = 'milestone_id'
    ) THEN
        ALTER TABLE payroll DROP COLUMN milestone_id;
    END IF;
END $$;

-- Drop unused milestone index from payroll if it exists
DROP INDEX IF EXISTS idx_payroll_milestone;
