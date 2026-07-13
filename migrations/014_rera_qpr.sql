-- ============================================================
-- Migration 014: RERA Quarterly Progress Report (Form B)
-- Adds 4 new tables for RERA compliance reporting.
-- Does NOT modify any existing tables.
-- Idempotent — safe to re-run.
-- ============================================================

-- -----------------------------------------------------------
-- 1. rera_color_thresholds: configurable % mapping per color
--    per work-item type (with global defaults)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rera_color_thresholds (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id    TEXT REFERENCES ventures(id),
    work_item     TEXT,
    color         TEXT NOT NULL CHECK (color IN ('red','yellow','blue','green')),
    pct_value     NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rera_thresholds_venture
    ON rera_color_thresholds(venture_id, work_item);

ALTER TABLE rera_color_thresholds ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rera_color_thresholds' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rera_color_thresholds FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Seed global defaults (venture_id = NULL, work_item = NULL)
INSERT INTO rera_color_thresholds (venture_id, work_item, color, pct_value)
VALUES
    (NULL, NULL, 'red',    0),
    (NULL, NULL, 'yellow', 40),
    (NULL, NULL, 'blue',   75),
    (NULL, NULL, 'green',  100)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------
-- 2. rera_statutory_approvals: statutory approvals/renewals
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rera_statutory_approvals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id          TEXT NOT NULL REFERENCES ventures(id),
    approval_name       TEXT NOT NULL,
    issuing_authority   TEXT,
    issued_date         DATE,
    expiry_date         DATE,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','pending','renewed')),
    remarks             TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rera_approvals_venture
    ON rera_statutory_approvals(venture_id);

ALTER TABLE rera_statutory_approvals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rera_statutory_approvals' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rera_statutory_approvals FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION update_rera_approvals_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = now();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_rera_approvals_updated_at ON rera_statutory_approvals;
CREATE TRIGGER trg_update_rera_approvals_updated_at
    BEFORE UPDATE ON rera_statutory_approvals
    FOR EACH ROW EXECUTE FUNCTION update_rera_approvals_updated_at();

-- -----------------------------------------------------------
-- 3. rera_quarterly_reports: locked, timestamped Form B snapshot
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rera_quarterly_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id      TEXT NOT NULL REFERENCES ventures(id),
    quarter         TEXT NOT NULL,
    quarter_start   DATE NOT NULL,
    quarter_end     DATE NOT NULL,
    filing_deadline DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','locked')),
    report_data     JSONB NOT NULL DEFAULT '{}',
    submitted_by    TEXT,
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(venture_id, quarter)
);

CREATE INDEX IF NOT EXISTS idx_rera_reports_venture
    ON rera_quarterly_reports(venture_id, quarter);

ALTER TABLE rera_quarterly_reports ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rera_quarterly_reports' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rera_quarterly_reports FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Trigger: prevent UPDATE or DELETE on locked/submitted reports
CREATE OR REPLACE FUNCTION prevent_rera_report_mutation()
RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('locked','submitted') THEN
        RAISE EXCEPTION 'Cannot modify a locked/submitted RERA quarterly report (id: %)', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_rera_report_update ON rera_quarterly_reports;
CREATE TRIGGER trg_prevent_rera_report_update
    BEFORE UPDATE ON rera_quarterly_reports
    FOR EACH ROW EXECUTE FUNCTION prevent_rera_report_mutation();

DROP TRIGGER IF EXISTS trg_prevent_rera_report_delete ON rera_quarterly_reports;
CREATE TRIGGER trg_prevent_rera_report_delete
    BEFORE DELETE ON rera_quarterly_reports
    FOR EACH ROW EXECUTE FUNCTION prevent_rera_report_mutation();

-- -----------------------------------------------------------
-- 4. rera_delay_log: delay/variance entries per quarter
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS rera_delay_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id    TEXT NOT NULL REFERENCES ventures(id),
    quarter       TEXT NOT NULL,
    block         TEXT,
    floor         TEXT,
    work_item     TEXT,
    delay_days    INTEGER DEFAULT 0,
    reason        TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rera_delays_venture
    ON rera_delay_log(venture_id, quarter);

ALTER TABLE rera_delay_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rera_delay_log' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rera_delay_log FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
