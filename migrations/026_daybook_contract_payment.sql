-- ============================================================
-- Migration 026: Day Book → Contract Payment linkage
-- Adds payment_type and contract_id to inventory_purchases so
-- Day Book entries can be linked to contractor contracts.
-- Idempotent — safe to re-run.
-- ============================================================

-- Add payment_type column (vendor | contract)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='inventory_purchases' AND column_name='payment_type'
    ) THEN
        ALTER TABLE inventory_purchases
            ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'vendor'
            CHECK (payment_type IN ('vendor','contract'));
    END IF;
END $$;

-- Add contract_id column (FK to contractor_contracts)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='inventory_purchases' AND column_name='contract_id'
    ) THEN
        ALTER TABLE inventory_purchases
            ADD COLUMN contract_id UUID REFERENCES contractor_contracts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Index for contract_id lookups
CREATE INDEX IF NOT EXISTS idx_ip_contract ON inventory_purchases(contract_id);
CREATE INDEX IF NOT EXISTS idx_ip_pay_type ON inventory_purchases(payment_type);
