-- ============================================================
-- Migration 003: Material Tracking — PO line items, material↔work_item link, budgets
-- Run this in Supabase SQL Editor (idempotent — safe to re-run)
-- ============================================================

-- -----------------------------------------------------------
-- 1. po_line_items: normalized PO line items for leakage analysis
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_line_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id         TEXT NOT NULL,
    venture_id    TEXT,
    material_id   TEXT REFERENCES materials(id),
    qty           NUMERIC NOT NULL DEFAULT 0,
    rate          NUMERIC NOT NULL DEFAULT 0,
    amount        NUMERIC GENERATED ALWAYS AS (qty * rate) STORED,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_line_items_po       ON po_line_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_material ON po_line_items(material_id);
CREATE INDEX IF NOT EXISTS idx_po_line_items_venture  ON po_line_items(venture_id);

ALTER TABLE po_line_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'po_line_items' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON po_line_items FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 2. materials: add optional linked_work_item column
-- -----------------------------------------------------------
ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS linked_work_item TEXT;

-- -----------------------------------------------------------
-- 3. budgets: daily or weekly budget entries per venture
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id    TEXT NOT NULL,
    budget_date   DATE NOT NULL,
    daily_budget  NUMERIC(12,2) NOT NULL DEFAULT 0,
    interval      TEXT NOT NULL DEFAULT 'daily' CHECK (interval IN ('daily','weekly')),
    created_by    TEXT,
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budgets_venture_date ON budgets(venture_id, budget_date);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'budgets' AND policyname = 'Allow all'
    ) THEN
        CREATE POLICY "Allow all" ON budgets FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
