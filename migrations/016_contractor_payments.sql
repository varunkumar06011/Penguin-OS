-- ============================================================
-- Migration 016: Contractor Payments Module
-- Tracks contractor contracts, work progress, and payment history
-- with org_id tenancy scoping and soft-delete on payments.
-- Idempotent — safe to re-run.
-- ============================================================

-- -----------------------------------------------------------
-- 1. contractor_contracts: per-contractor deal records
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractor_contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL,
    venture_id      TEXT,
    person_name     TEXT NOT NULL,
    work_description TEXT NOT NULL,
    total_amount    NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
    total_units     INT NOT NULL CHECK (total_units > 0),
    completed_units INT NOT NULL DEFAULT 0 CHECK (completed_units >= 0),
    unit_label      TEXT NOT NULL DEFAULT 'units',
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
    notes           TEXT DEFAULT '',
    created_by      TEXT,
    updated_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CHECK (completed_units <= total_units)
);

CREATE INDEX IF NOT EXISTS idx_contractor_contracts_org ON contractor_contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_contractor_contracts_venture ON contractor_contracts(venture_id);

ALTER TABLE contractor_contracts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'contractor_contracts' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON contractor_contracts FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_contractor_contracts_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = now();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_contractor_contracts_updated_at ON contractor_contracts;
CREATE TRIGGER trg_update_contractor_contracts_updated_at
    BEFORE UPDATE ON contractor_contracts
    FOR EACH ROW EXECUTE FUNCTION update_contractor_contracts_updated_at();

-- -----------------------------------------------------------
-- 2. contractor_payments: payment records per contract
--    Soft-deleted only (is_deleted flag) — no hard deletes.
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractor_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id     UUID NOT NULL REFERENCES contractor_contracts(id) ON DELETE RESTRICT,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_date    DATE NOT NULL,
    method          TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','upi','cheque','bank_transfer')),
    reference       TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    deletion_reason TEXT DEFAULT '',
    deleted_by      TEXT,
    deleted_at      TIMESTAMPTZ,
    recorded_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_payments_contract ON contractor_payments(contract_id);

ALTER TABLE contractor_payments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'contractor_payments' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON contractor_payments FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 3. Idempotent upgrades for already-deployed tables
--    (safe to re-run on existing databases)
-- -----------------------------------------------------------

-- Add updated_by column if missing (for audit trail of who changed a contract)
ALTER TABLE contractor_contracts ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Add completed_units <= total_units CHECK if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'contractor_contracts_completed_units_check1'
        AND conrelid = 'contractor_contracts'::regclass
    ) THEN
        ALTER TABLE contractor_contracts
            ADD CONSTRAINT contractor_contracts_completed_units_check1
            CHECK (completed_units <= total_units);
    END IF;
END $$;

-- Change FK from CASCADE to RESTRICT (drop & recreate if still CASCADE)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.referential_constraints
        WHERE constraint_name = 'contractor_payments_contract_id_fkey'
        AND delete_rule = 'CASCADE'
    ) THEN
        ALTER TABLE contractor_payments DROP CONSTRAINT contractor_payments_contract_id_fkey;
        ALTER TABLE contractor_payments ADD CONSTRAINT contractor_payments_contract_id_fkey
            FOREIGN KEY (contract_id) REFERENCES contractor_contracts(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- -----------------------------------------------------------
-- 4. BEFORE DELETE trigger: block hard-delete on contractor_contracts
--    Contracts must be soft-cancelled (status='cancelled'), never hard-deleted,
--    to preserve the financial audit trail of their payment history.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_contractor_contract_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Cannot hard-delete contractor_contracts (id=%). Use status = ''cancelled'' to soft-cancel instead.', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_contractor_contract_delete ON contractor_contracts;
CREATE TRIGGER trg_prevent_contractor_contract_delete
    BEFORE DELETE ON contractor_contracts
    FOR EACH ROW EXECUTE FUNCTION prevent_contractor_contract_delete();
