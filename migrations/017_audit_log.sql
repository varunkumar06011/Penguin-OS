-- ============================================================
-- Migration 017: Audit Log — captures destructive config changes
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID,
    user_email  TEXT,
    action      TEXT NOT NULL,
    target_id   TEXT,
    old_data    JSONB,
    new_data    JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON audit_log FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
