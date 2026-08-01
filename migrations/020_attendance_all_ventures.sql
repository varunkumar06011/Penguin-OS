-- ============================================================
-- Migration 020: Allow "All Ventures" attendance rows
-- Drops the FK constraint on attendance.venture_id so that
-- venture_id='__all__' can be used for employees that span
-- all ventures (common labor, managers overseeing everything).
-- Idempotent - safe to re-run.
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'attendance_venture_id_fkey'
    ) THEN
        ALTER TABLE attendance DROP CONSTRAINT attendance_venture_id_fkey;
    END IF;
END $$;
