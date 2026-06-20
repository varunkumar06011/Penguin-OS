-- ============================================================
-- Migration 001: Fix upsert conflicts & deduplicate rows
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. cell_data
-- -----------------------------------------------------------
-- Deduplicate: keep row with latest data->>'updated_at', tie-break by ctid
DELETE FROM cell_data
WHERE ctid NOT IN (
    SELECT DISTINCT ON (id) ctid
    FROM cell_data
    ORDER BY id, COALESCE(data->>'updated_at', '') DESC, ctid DESC
);

-- Add UNIQUE constraint on id (idempotent)
ALTER TABLE cell_data ADD CONSTRAINT IF NOT EXISTS cell_data_id_unique UNIQUE (id);

-- Enable RLS + full-access policy for anon role (app enforces auth in Flask)
ALTER TABLE cell_data ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cell_data' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON cell_data FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 2. ventures
-- -----------------------------------------------------------
DELETE FROM ventures
WHERE ctid NOT IN (
    SELECT DISTINCT ON (id) ctid
    FROM ventures
    ORDER BY id, COALESCE(data->>'updated_at', '') DESC, ctid DESC
);

ALTER TABLE ventures ADD CONSTRAINT IF NOT EXISTS ventures_id_unique UNIQUE (id);
ALTER TABLE ventures ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ventures' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON ventures FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 3. invoices
-- -----------------------------------------------------------
DELETE FROM invoices
WHERE ctid NOT IN (
    SELECT DISTINCT ON (id) ctid
    FROM invoices
    ORDER BY id, COALESCE(data->>'updated_at', '') DESC, ctid DESC
);

ALTER TABLE invoices ADD CONSTRAINT IF NOT EXISTS invoices_id_unique UNIQUE (id);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'invoices' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON invoices FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 4. purchase_orders
-- -----------------------------------------------------------
DELETE FROM purchase_orders
WHERE ctid NOT IN (
    SELECT DISTINCT ON (id) ctid
    FROM purchase_orders
    ORDER BY id, COALESCE(data->>'updated_at', '') DESC, ctid DESC
);

ALTER TABLE purchase_orders ADD CONSTRAINT IF NOT EXISTS purchase_orders_id_unique UNIQUE (id);
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'purchase_orders' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 5. vendors
-- -----------------------------------------------------------
DELETE FROM vendors
WHERE ctid NOT IN (
    SELECT DISTINCT ON (id) ctid
    FROM vendors
    ORDER BY id, COALESCE(data->>'updated_at', '') DESC, ctid DESC
);

ALTER TABLE vendors ADD CONSTRAINT IF NOT EXISTS vendors_id_unique UNIQUE (id);
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vendors' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON vendors FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 6. settings
-- -----------------------------------------------------------
DELETE FROM settings
WHERE ctid NOT IN (
    SELECT DISTINCT ON (key) ctid
    FROM settings
    ORDER BY key, ctid DESC
);

ALTER TABLE settings ADD CONSTRAINT IF NOT EXISTS settings_key_unique UNIQUE (key);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'settings' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON settings FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
