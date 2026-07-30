-- ============================================================
-- Migration 002b: Inventory tracking (materials + stock ledger)
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. materials master list
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id            TEXT PRIMARY KEY,
    venture_id    TEXT NOT NULL,
    name          TEXT NOT NULL,
    category      TEXT,
    unit          TEXT NOT NULL,
    min_threshold NUMERIC DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'materials_id_unique' AND conrelid = 'materials'::regclass
    ) THEN
        ALTER TABLE materials ADD CONSTRAINT materials_id_unique UNIQUE (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_materials_venture ON materials(venture_id);

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'materials' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON materials FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 2. stock_ledger (every IN / OUT / ADJUST movement)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_ledger (
    id            TEXT PRIMARY KEY,
    venture_id    TEXT NOT NULL,
    material_id   TEXT NOT NULL REFERENCES materials(id),
    entry_type    TEXT NOT NULL CHECK (entry_type IN ('IN','OUT','ADJUST')),
    qty           NUMERIC NOT NULL,
    entry_date    DATE NOT NULL,

    -- IN entry fields (purchase / delivery)
    vendor_id     TEXT,
    invoice_id    TEXT,
    po_id         TEXT,
    rate          NUMERIC,
    amount        NUMERIC,

    -- OUT entry fields (consumption at location)
    block         TEXT,
    floor         TEXT,
    flat          TEXT,
    work_item     TEXT,

    remarks       TEXT,
    created_by    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_ledger_id_unique' AND conrelid = 'stock_ledger'::regclass
    ) THEN
        ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_id_unique UNIQUE (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ledger_material ON stock_ledger(material_id);
CREATE INDEX IF NOT EXISTS idx_ledger_venture  ON stock_ledger(venture_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date      ON stock_ledger(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_location  ON stock_ledger(venture_id, block, floor, flat);
CREATE INDEX IF NOT EXISTS idx_ledger_vendor    ON stock_ledger(vendor_id);

ALTER TABLE stock_ledger ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'stock_ledger' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON stock_ledger FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 3. stock_balance view (computed balance per venture/material)
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW stock_balance AS
SELECT
    venture_id,
    material_id,
    SUM(CASE WHEN entry_type = 'IN'  THEN qty ELSE 0 END) AS total_in,
    SUM(CASE WHEN entry_type = 'OUT' THEN qty ELSE 0 END) AS total_out,
    SUM(CASE WHEN entry_type = 'ADJUST' THEN qty ELSE 0 END) AS total_adjust,
    SUM(CASE
        WHEN entry_type = 'IN'  THEN qty
        WHEN entry_type = 'OUT' THEN -qty
        ELSE qty
    END) AS balance
FROM stock_ledger
GROUP BY venture_id, material_id;
