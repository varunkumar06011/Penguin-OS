-- ============================================================
-- Migration 018: User Preferences - per-user work view layout
-- Stores drag-to-reorder preferences for categories and work items.
-- Per-user, global across ventures, persists across relogin.
-- Idempotent - safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    UUID NOT NULL,
    pref_key   TEXT NOT NULL DEFAULT 'work_view_layout',
    pref_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, pref_key)
);

-- Add FK to users if the table exists (optional - won't fail if users is absent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'user_prefs_user_id_fkey'
        ) THEN
            ALTER TABLE user_prefs
            ADD CONSTRAINT user_prefs_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_prefs(user_id);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON user_prefs;
CREATE POLICY "Allow all" ON user_prefs FOR ALL TO anon USING (true) WITH CHECK (true);
