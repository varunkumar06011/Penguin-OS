-- ============================================================
-- Migration 022: Day Book enhancements — payment_method, proof_image
-- Idempotent — safe to re-run.
-- ============================================================

-- Add payment_method to inventory_purchases
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_purchases' AND column_name='payment_method') THEN
        ALTER TABLE inventory_purchases ADD COLUMN payment_method TEXT DEFAULT NULL;
    END IF;
END $$;

-- Add proof_image (base64 data URL) to inventory_purchases
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_purchases' AND column_name='proof_image') THEN
        ALTER TABLE inventory_purchases ADD COLUMN proof_image TEXT DEFAULT NULL;
    END IF;
END $$;

-- Update payment method CHECK constraint on inventory_purchase_payments to include card and other
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_purchase_payments' AND column_name='method') THEN
        -- Drop old constraint if exists and add new one with more options
        ALTER TABLE inventory_purchase_payments DROP CONSTRAINT IF EXISTS inventory_purchase_payments_method_check;
        ALTER TABLE inventory_purchase_payments ADD CONSTRAINT inventory_purchase_payments_method_check
            CHECK (method IN ('cash','upi','card','cheque','bank_transfer','other'));
    END IF;
END $$;
