-- ============================================================
-- Migration 011: RWA Elite Tier
-- Patrol logs, Maintenance invoices, Payments, Vendor ledger, Reports
-- Idempotent — safe to re-run
-- ============================================================

-- Patrol checkpoints & logs
CREATE TABLE IF NOT EXISTS patrol_checkpoints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    qr_code         TEXT UNIQUE,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE patrol_checkpoints ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'patrol_checkpoints' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON patrol_checkpoints FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS patrol_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id   UUID NOT NULL REFERENCES patrol_checkpoints(id) ON DELETE CASCADE,
    security_id     UUID REFERENCES security_users(id) ON DELETE SET NULL,
    scanned_at      TIMESTAMPTZ DEFAULT now(),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_patrol_logs_cp ON patrol_logs(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_patrol_logs_sec ON patrol_logs(security_id);

ALTER TABLE patrol_logs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'patrol_logs' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON patrol_logs FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Maintenance invoices (separate from construction invoices)
CREATE TABLE IF NOT EXISTS rwa_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flat_id         UUID REFERENCES flats(id) ON DELETE SET NULL,
    resident_id     UUID REFERENCES residents(id) ON DELETE SET NULL,
    invoice_number  TEXT UNIQUE NOT NULL,
    billing_month   TEXT NOT NULL,
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date        DATE,
    status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','overdue','cancelled')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rwa_inv_flat   ON rwa_invoices(flat_id);
CREATE INDEX IF NOT EXISTS idx_rwa_inv_res    ON rwa_invoices(resident_id);
CREATE INDEX IF NOT EXISTS idx_rwa_inv_status ON rwa_invoices(status);
CREATE INDEX IF NOT EXISTS idx_rwa_inv_month  ON rwa_invoices(billing_month);

ALTER TABLE rwa_invoices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rwa_invoices' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rwa_invoices FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Payments
CREATE TABLE IF NOT EXISTS rwa_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES rwa_invoices(id) ON DELETE CASCADE,
    amount          NUMERIC(12,2) NOT NULL,
    method          TEXT,
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rwa_pay_inv ON rwa_payments(invoice_id);

ALTER TABLE rwa_payments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rwa_payments' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rwa_payments FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Vendor ledger (separate from construction vendor invoices)
CREATE TABLE IF NOT EXISTS rwa_vendor_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name     TEXT NOT NULL,
    category        TEXT,
    invoice_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partially_paid','paid')),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rwa_vl_status ON rwa_vendor_ledger(status);

ALTER TABLE rwa_vendor_ledger ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'rwa_vendor_ledger' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON rwa_vendor_ledger FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
