-- ============================================================
-- Migration 012: Visitor Quick QR + Delivery Timer
-- Adds QR pass fields to visitor_requests, delivery timer fields
-- to deliveries, and a resident profile extension.
-- Idempotent — safe to re-run
-- ============================================================

-- Extend visitor_requests with QR pass metadata
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'visitor_requests' AND column_name = 'qr_pass_code'
    ) THEN
        ALTER TABLE visitor_requests ADD COLUMN qr_pass_code TEXT UNIQUE;
    END IF;
END $$;

-- Extend deliveries with timer + QR fields
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'delivery_person_name'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN delivery_person_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'vehicle_number'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN vehicle_number TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'qr_code'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN qr_code TEXT UNIQUE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'entry_time'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN entry_time TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'exit_time'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN exit_time TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'deliveries' AND column_name = 'alerted'
    ) THEN
        ALTER TABLE deliveries ADD COLUMN alerted BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Widen status CHECK on deliveries to include inside/expired
DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT tc.constraint_name INTO con_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_name = 'deliveries'
      AND tc.constraint_type = 'CHECK'
      AND tc.constraint_definition LIKE '%status%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE deliveries DROP CONSTRAINT %I', con_name);
    END IF;

    ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
        CHECK (status IN ('arrived','inside','collected','returned','expired'));
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not alter deliveries status constraint: %', SQLERRM;
END $$;

-- Add a profile fields to residents (additive)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'residents' AND column_name = 'email'
    ) THEN
        ALTER TABLE residents ADD COLUMN email TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'residents' AND column_name = 'photo_url'
    ) THEN
        ALTER TABLE residents ADD COLUMN photo_url TEXT;
    END IF;
END $$;
