CREATE TABLE IF NOT EXISTS inventory_materials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111',
    name        TEXT NOT NULL,
    unit        TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_mat_unique
    ON inventory_materials (org_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_inv_mat_org ON inventory_materials(org_id);
ALTER TABLE inventory_materials ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_materials' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON inventory_materials FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 2. inventory_categories: categories + optional types (self-ref)
--    parent_id NULL  => category
--    parent_id NOT NULL => type under that category
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111',
    name        TEXT NOT NULL,
    parent_id   UUID REFERENCES inventory_categories(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_cat_unique
    ON inventory_categories (org_id, lower(name), COALESCE(parent_id,'00000000-0000-0000-0000-000000000000'));
CREATE INDEX IF NOT EXISTS idx_inv_cat_org    ON inventory_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_inv_cat_parent ON inventory_categories(parent_id);
ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_categories' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON inventory_categories FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 3. inventory_purchases: the purchase ledger (single source of truth)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_purchases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111',
    venture_id      TEXT,
    invoice_date    DATE,
    invoice_no      TEXT,
    is_gst          BOOLEAN NOT NULL DEFAULT false,
    gstin           TEXT,
    received_date   DATE,
    description     TEXT DEFAULT '',
    vendor_id       TEXT,
    vendor_name     TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    category        TEXT,
    category_type   TEXT,
    qty             NUMERIC NOT NULL DEFAULT 0,
    unit            TEXT,
    rate            NUMERIC NOT NULL DEFAULT 0,
    amount          NUMERIC NOT NULL DEFAULT 0,
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ip_org     ON inventory_purchases(org_id);
CREATE INDEX IF NOT EXISTS idx_ip_venture ON inventory_purchases(venture_id);
CREATE INDEX IF NOT EXISTS idx_ip_vendor  ON inventory_purchases(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ip_date    ON inventory_purchases(invoice_date);
CREATE INDEX IF NOT EXISTS idx_ip_recv    ON inventory_purchases(received_date);
CREATE INDEX IF NOT EXISTS idx_ip_cat     ON inventory_purchases(category);
CREATE INDEX IF NOT EXISTS idx_ip_mat     ON inventory_purchases(material_name);
ALTER TABLE inventory_purchases ENABLE ROW LEVEL SECURITY;
-- Add remarks column if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_purchases' AND column_name='remarks') THEN
        ALTER TABLE inventory_purchases ADD COLUMN remarks TEXT DEFAULT '';
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_purchases' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON inventory_purchases FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 4. inventory_purchase_payments: payments against a vendor
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_purchase_payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111',
    vendor_id     TEXT,
    vendor_name   TEXT NOT NULL,
    purchase_id   UUID REFERENCES inventory_purchases(id) ON DELETE SET NULL,
    amount        NUMERIC NOT NULL CHECK (amount > 0),
    payment_date  DATE NOT NULL,
    method        TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','upi','cheque','bank_transfer')),
    reference     TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    created_by    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ipp_org    ON inventory_purchase_payments(org_id);
CREATE INDEX IF NOT EXISTS idx_ipp_vendor ON inventory_purchase_payments(vendor_id);
ALTER TABLE inventory_purchase_payments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_purchase_payments' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON inventory_purchase_payments FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 5. daily_inventory: running opening/purchase/total/usage/balance
--    purchase is DERIVED from inventory_purchases (single source of truth).
--    Stored as a snapshot for history; GET recomputes live.
--    Unique on (org_id, venture_id, material_name, category_type, entry_date).
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_inventory (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL DEFAULT '11111111-1111-1111-1111-111111111111',
    venture_id    TEXT,
    entry_date    DATE NOT NULL,
    material_name TEXT NOT NULL,
    category      TEXT,
    category_type TEXT,
    flat_no       TEXT,
    opening       NUMERIC NOT NULL DEFAULT 0,
    purchase      NUMERIC NOT NULL DEFAULT 0,
    total         NUMERIC NOT NULL DEFAULT 0,
    usage_qty     NUMERIC NOT NULL DEFAULT 0,
    balance       NUMERIC NOT NULL DEFAULT 0,
    notes         TEXT DEFAULT '',
    created_by    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_di_unique
    ON daily_inventory (org_id, venture_id, material_name, COALESCE(category_type,''), entry_date);
CREATE INDEX IF NOT EXISTS idx_di_venture  ON daily_inventory(venture_id);
CREATE INDEX IF NOT EXISTS idx_di_date     ON daily_inventory(entry_date);
CREATE INDEX IF NOT EXISTS idx_di_material ON daily_inventory(material_name);
ALTER TABLE daily_inventory ENABLE ROW LEVEL SECURITY;
-- Add remarks column if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daily_inventory' AND column_name='remarks') THEN
        ALTER TABLE daily_inventory ADD COLUMN remarks TEXT DEFAULT '';
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_inventory' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON daily_inventory FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;
