-- ============================================================
-- Migration 027: Day Book — expand payment_type to include
-- 'inventory' and 'other' entry types.
-- Idempotent — safe to re-run.
-- ============================================================

-- Drop the old CHECK constraint and add a new one with all 4 types
DO $$
BEGIN
    -- Remove old constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_purchases_payment_type_check'
          AND conrelid = 'inventory_purchases'::regclass
    ) THEN
        ALTER TABLE inventory_purchases DROP CONSTRAINT inventory_purchases_payment_type_check;
    END IF;
    -- Add expanded constraint
    ALTER TABLE inventory_purchases
        ADD CONSTRAINT inventory_purchases_payment_type_check
        CHECK (payment_type IN ('vendor','contract','inventory','other'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
END $$;
