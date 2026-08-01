-- ============================================================
-- Migration 019: Attendance table + archive old payroll data
-- Replaces the old payroll feature (stored in settings as JSON blobs)
-- with a normalized attendance table for proper querying/reporting.
-- Old payroll data is archived (renamed), not deleted - recoverable.
-- Idempotent - safe to re-run.
-- ============================================================

-- -----------------------------------------------------------
-- 1. attendance: per-employee per-month attendance records
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id      TEXT NOT NULL,
    employee_name   TEXT NOT NULL,
    role            TEXT DEFAULT '',
    base_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
    month           TEXT NOT NULL,
    present_days    INT NOT NULL DEFAULT 0,
    absent_days     INT NOT NULL DEFAULT 0,
    daily_marking   JSONB DEFAULT '{}'::jsonb,
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (venture_id, employee_name, month)
);

-- Add FK to ventures if the table exists (optional - won't fail if ventures is absent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ventures') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'attendance_venture_id_fkey'
        ) THEN
            ALTER TABLE attendance
            ADD CONSTRAINT attendance_venture_id_fkey
            FOREIGN KEY (venture_id) REFERENCES ventures(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attendance_venture ON attendance(venture_id);
CREATE INDEX IF NOT EXISTS idx_attendance_month ON attendance(month);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON attendance;
CREATE POLICY "Allow all" ON attendance FOR ALL TO anon USING (true) WITH CHECK (true);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = now();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_attendance_updated_at ON attendance;
CREATE TRIGGER trg_update_attendance_updated_at
    BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION update_attendance_updated_at();

-- -----------------------------------------------------------
-- 2. Archive old payroll data (fresh start - recoverable)
--    Rename keys so the UI can't find them, but data is preserved.
--    The app only looks up exact 'payroll_{ventureId}_{month}' keys.
-- -----------------------------------------------------------
UPDATE settings SET key = 'archived_' || key
WHERE key LIKE 'payroll_%' AND key NOT LIKE 'archived_%';
