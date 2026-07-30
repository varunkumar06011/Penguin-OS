-- ============================================================
-- Migration 015: Inventory Ready — Global materials, WAREHOUSE,
--   cost tracking, cell usage, user management, alerts, budgets
-- Run after migrations 000-014. Idempotent — safe to re-run.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Make material catalog global (nullable venture_id)
-- -----------------------------------------------------------
ALTER TABLE materials ALTER COLUMN venture_id DROP NOT NULL;

ALTER TABLE materials ADD COLUMN IF NOT EXISTS superseded_by TEXT REFERENCES materials(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_global_unique
    ON materials(name, unit)
    WHERE venture_id IS NULL;

-- -----------------------------------------------------------
-- 2. WAREHOUSE pseudo-venture + org_id / name backfill
-- -----------------------------------------------------------
INSERT INTO ventures (id, name, org_id, data)
VALUES ('WAREHOUSE', 'Central Warehouse',
        '11111111-1111-1111-1111-111111111111',
        jsonb_build_object('id', 'WAREHOUSE', 'name', 'Central Warehouse', 'blocks', '[]'::jsonb))
ON CONFLICT (id) DO NOTHING;

UPDATE ventures
SET org_id = COALESCE(
        NULLIF(data->>'org_id', '')::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid
    )
WHERE org_id IS NULL;

UPDATE ventures
SET name = data->>'name'
WHERE name IS NULL AND data->>'name' IS NOT NULL;

ALTER TABLE ventures ALTER COLUMN org_id SET NOT NULL;

-- -----------------------------------------------------------
-- 3. Extend stock_ledger with cost + transfer + wastage columns
-- -----------------------------------------------------------
ALTER TABLE stock_ledger
    ADD COLUMN IF NOT EXISTS consuming_venture_id TEXT,
    ADD COLUMN IF NOT EXISTS source_venture_id TEXT,
    ADD COLUMN IF NOT EXISTS is_wastage BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_cost NUMERIC GENERATED ALWAYS AS (qty * cost_per_unit) STORED,
    ADD COLUMN IF NOT EXISTS linked_usage_id UUID;

CREATE INDEX IF NOT EXISTS idx_ledger_consuming ON stock_ledger(consuming_venture_id);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON stock_ledger(source_venture_id);
CREATE INDEX IF NOT EXISTS idx_ledger_wastage ON stock_ledger(is_wastage);
CREATE INDEX IF NOT EXISTS idx_ledger_linked_usage ON stock_ledger(linked_usage_id);

-- -----------------------------------------------------------
-- 4. Backfill cost_per_unit from existing rate
-- -----------------------------------------------------------
UPDATE stock_ledger
SET cost_per_unit = rate
WHERE entry_type = 'IN'
  AND COALESCE(cost_per_unit, 0) = 0
  AND COALESCE(rate, 0) > 0;

-- -----------------------------------------------------------
-- 5. cell_material_usage
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS cell_material_usage (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id             TEXT NOT NULL,
    venture_id          TEXT NOT NULL,
    material_id         TEXT NOT NULL REFERENCES materials(id),
    block               TEXT,
    floor               TEXT,
    flat                TEXT,
    work_item           TEXT,
    qty_used            NUMERIC NOT NULL DEFAULT 0,
    qty_wasted          NUMERIC NOT NULL DEFAULT 0,
    wastage_reason      TEXT,
    entry_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    cost_per_unit       NUMERIC NOT NULL DEFAULT 0,
    total_cost          NUMERIC GENERATED ALWAYS AS (qty_used * cost_per_unit) STORED,
    reversed_qty        NUMERIC NOT NULL DEFAULT 0,
    stock_ledger_out_id TEXT,
    stock_ledger_waste_id TEXT,
    created_by          TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cell_material_usage
    ADD COLUMN IF NOT EXISTS remaining_qty NUMERIC GENERATED ALWAYS AS (qty_used - reversed_qty) STORED;

CREATE INDEX IF NOT EXISTS idx_cell_usage_cell ON cell_material_usage(cell_id);
CREATE INDEX IF NOT EXISTS idx_cell_usage_venture ON cell_material_usage(venture_id);
CREATE INDEX IF NOT EXISTS idx_cell_usage_material ON cell_material_usage(material_id);
CREATE INDEX IF NOT EXISTS idx_cell_usage_date ON cell_material_usage(entry_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cell_usage_unique_active
    ON cell_material_usage(cell_id, material_id, entry_date)
    WHERE remaining_qty > 0;

ALTER TABLE cell_material_usage ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cell_material_usage' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON cell_material_usage FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 6. cell_material_usage_reversals
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS cell_material_usage_reversals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usage_id        UUID NOT NULL REFERENCES cell_material_usage(id),
    reversed_qty    NUMERIC NOT NULL DEFAULT 0,
    reason          TEXT,
    stock_ledger_adjust_id TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE cell_material_usage_reversals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cell_material_usage_reversals' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON cell_material_usage_reversals FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 7. material_budgets (per-material quantity budgets)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_budgets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id          TEXT NOT NULL,
    material_id         TEXT NOT NULL REFERENCES materials(id),
    budget_qty          NUMERIC NOT NULL DEFAULT 0,
    budget_value        NUMERIC NOT NULL DEFAULT 0,
    alert_threshold_pct NUMERIC NOT NULL DEFAULT 80,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(venture_id, material_id)
);

ALTER TABLE material_budgets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='material_budgets' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON material_budgets FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 8. inventory_alerts
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venture_id      TEXT,
    material_id     TEXT REFERENCES materials(id),
    alert_type      TEXT NOT NULL CHECK (alert_type IN ('low_stock','budget_exceeded','negative_stock','shortage','missing_cost')),
    message         TEXT NOT NULL,
    is_resolved     BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_open_unique
    ON inventory_alerts(venture_id, material_id, alert_type)
    WHERE is_resolved = false;

ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_alerts' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON inventory_alerts FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 9. user_ventures (venture assignments for supervisors)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_ventures (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venture_id  TEXT NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, venture_id)
);

ALTER TABLE user_ventures ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_ventures' AND policyname='Allow all') THEN
        CREATE POLICY "Allow all" ON user_ventures FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- -----------------------------------------------------------
-- 10. Updated stock_balance view (preserves total_out for backward compat)
-- -----------------------------------------------------------
DROP VIEW IF EXISTS stock_balance;
CREATE VIEW stock_balance AS
SELECT
    venture_id,
    material_id,
    SUM(CASE WHEN entry_type = 'IN' THEN qty ELSE 0 END) AS total_in,
    SUM(CASE WHEN entry_type = 'OUT' THEN qty ELSE 0 END) AS total_out,
    SUM(CASE WHEN entry_type = 'OUT' AND is_wastage = false THEN qty ELSE 0 END) AS total_used,
    SUM(CASE WHEN entry_type = 'OUT' AND is_wastage = true THEN qty ELSE 0 END) AS total_wasted,
    SUM(CASE WHEN entry_type = 'ADJUST' THEN qty ELSE 0 END) AS total_adjust,
    SUM(CASE
        WHEN entry_type = 'IN' THEN qty
        WHEN entry_type = 'OUT' THEN -qty
        ELSE qty
    END) AS balance
FROM stock_ledger
GROUP BY venture_id, material_id;

-- -----------------------------------------------------------
-- 11. venture_consumption view
-- -----------------------------------------------------------
DROP VIEW IF EXISTS venture_consumption;
CREATE VIEW venture_consumption AS
SELECT
    COALESCE(consuming_venture_id, venture_id) AS venture_id,
    material_id,
    SUM(CASE WHEN is_wastage = false THEN qty ELSE 0 END) AS qty_used,
    SUM(CASE WHEN is_wastage = true THEN qty ELSE 0 END) AS qty_wasted,
    SUM(total_cost) AS total_cost
FROM stock_ledger
WHERE entry_type = 'OUT'
GROUP BY COALESCE(consuming_venture_id, venture_id), material_id;

-- ============================================================
-- 12. Atomic Postgres Functions
-- ============================================================

-- -----------------------------------------------------------
-- 12a. refresh_inventory_alert
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_inventory_alert(
    p_venture_id TEXT, p_material_id TEXT
) RETURNS VOID AS $$
DECLARE
    v_balance NUMERIC;
    v_min_threshold NUMERIC;
    v_budget_qty NUMERIC;
    v_consumed_qty NUMERIC;
    v_threshold_pct NUMERIC;
BEGIN
    SELECT balance INTO v_balance
    FROM stock_balance
    WHERE venture_id = p_venture_id AND material_id = p_material_id;

    SELECT min_threshold INTO v_min_threshold
    FROM materials WHERE id = p_material_id;

    IF COALESCE(v_balance, 0) <= COALESCE(v_min_threshold, 0) THEN
        INSERT INTO inventory_alerts (venture_id, material_id, alert_type, message)
        VALUES (p_venture_id, p_material_id, 'low_stock',
                'Stock below threshold: ' || COALESCE(v_balance, 0))
        ON CONFLICT (venture_id, material_id, alert_type) WHERE is_resolved = false
        DO UPDATE SET message = EXCLUDED.message, created_at = now();
    ELSE
        UPDATE inventory_alerts SET is_resolved = true
        WHERE venture_id = p_venture_id AND material_id = p_material_id
          AND alert_type = 'low_stock' AND is_resolved = false;
    END IF;

    SELECT budget_qty, alert_threshold_pct INTO v_budget_qty, v_threshold_pct
    FROM material_budgets WHERE venture_id = p_venture_id AND material_id = p_material_id;

    IF v_budget_qty IS NOT NULL THEN
        SELECT COALESCE(SUM(qty), 0) INTO v_consumed_qty
        FROM stock_ledger
        WHERE venture_id = p_venture_id AND material_id = p_material_id
          AND entry_type = 'OUT' AND is_wastage = false;

        IF v_consumed_qty >= v_budget_qty * v_threshold_pct / 100 THEN
            INSERT INTO inventory_alerts (venture_id, material_id, alert_type, message)
            VALUES (p_venture_id, p_material_id, 'budget_exceeded',
                    'Consumption ' || v_consumed_qty || ' exceeds ' || v_threshold_pct || '% of budget ' || v_budget_qty)
            ON CONFLICT (venture_id, material_id, alert_type) WHERE is_resolved = false
            DO UPDATE SET message = EXCLUDED.message, created_at = now();
        ELSE
            UPDATE inventory_alerts SET is_resolved = true
            WHERE venture_id = p_venture_id AND material_id = p_material_id
              AND alert_type = 'budget_exceeded' AND is_resolved = false;
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 12b. record_cell_usage (incremental semantics)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION record_cell_usage(
    p_cell_id TEXT, p_venture_id TEXT, p_block TEXT, p_floor TEXT,
    p_flat TEXT, p_work_item TEXT, p_material_id TEXT,
    p_qty_used NUMERIC, p_qty_wasted NUMERIC, p_wastage_reason TEXT,
    p_entry_date DATE, p_created_by TEXT
) RETURNS JSONB AS $$
DECLARE
    v_active_id UUID;
    v_cost NUMERIC;
    v_balance NUMERIC;
    v_required NUMERIC;
    v_out_id TEXT;
    v_waste_id TEXT;
    v_usage_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('stock:' || p_venture_id || ':' || p_material_id));

    SELECT id INTO v_active_id
    FROM cell_material_usage
    WHERE cell_id = p_cell_id
      AND material_id = p_material_id
      AND entry_date = p_entry_date
      AND remaining_qty > 0
    FOR UPDATE;

    SELECT COALESCE(SUM(total_cost) / NULLIF(SUM(qty), 0), 0) INTO v_cost
    FROM stock_ledger
    WHERE venture_id = p_venture_id
      AND material_id = p_material_id
      AND entry_type = 'IN';

    SELECT balance INTO v_balance
    FROM stock_balance
    WHERE venture_id = p_venture_id AND material_id = p_material_id;

    v_required := p_qty_used + p_qty_wasted;
    IF COALESCE(v_balance, 0) < v_required THEN
        RAISE EXCEPTION 'Insufficient stock: need %, have %', v_required, COALESCE(v_balance, 0);
    END IF;

    v_out_id := gen_random_uuid()::text;
    INSERT INTO stock_ledger (id, venture_id, material_id, consuming_venture_id,
        entry_type, qty, cost_per_unit, entry_date, block, floor, flat, work_item,
        is_wastage, created_by)
    VALUES (v_out_id, p_venture_id, p_material_id, p_venture_id,
        'OUT', p_qty_used, v_cost, p_entry_date, p_block, p_floor, p_flat, p_work_item,
        false, p_created_by);

    IF p_qty_wasted > 0 THEN
        v_waste_id := gen_random_uuid()::text;
        INSERT INTO stock_ledger (id, venture_id, material_id, consuming_venture_id,
            entry_type, qty, cost_per_unit, entry_date, block, floor, flat, work_item,
            is_wastage, remarks, created_by)
        VALUES (v_waste_id, p_venture_id, p_material_id, p_venture_id,
            'OUT', p_qty_wasted, v_cost, p_entry_date, p_block, p_floor, p_flat, p_work_item,
            true, p_wastage_reason, p_created_by);
    END IF;

    IF v_active_id IS NOT NULL THEN
        UPDATE cell_material_usage
        SET qty_used = qty_used + p_qty_used,
            qty_wasted = qty_wasted + p_qty_wasted,
            cost_per_unit = v_cost
        WHERE id = v_active_id;
        v_usage_id := v_active_id;
    ELSE
        v_usage_id := gen_random_uuid();
        INSERT INTO cell_material_usage (id, cell_id, venture_id, material_id,
            block, floor, flat, work_item, qty_used, qty_wasted, wastage_reason,
            entry_date, cost_per_unit, stock_ledger_out_id, stock_ledger_waste_id,
            created_by)
        VALUES (v_usage_id, p_cell_id, p_venture_id, p_material_id,
            p_block, p_floor, p_flat, p_work_item, p_qty_used, p_qty_wasted, p_wastage_reason,
            p_entry_date, v_cost, v_out_id, v_waste_id, p_created_by);
    END IF;

    PERFORM refresh_inventory_alert(p_venture_id, p_material_id);

    RETURN jsonb_build_object('success', true, 'usage_id', v_usage_id);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 12c. reverse_cell_usage (lock-ordering: advisory lock before row lock)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_cell_usage(
    p_usage_id UUID, p_reverse_qty NUMERIC, p_reason TEXT, p_created_by TEXT
) RETURNS JSONB AS $$
DECLARE
    v_venture_id TEXT;
    v_material_id TEXT;
    v_cost NUMERIC;
    v_remaining NUMERIC;
    v_adjust_id TEXT;
BEGIN
    SELECT venture_id, material_id INTO v_venture_id, v_material_id
    FROM cell_material_usage WHERE id = p_usage_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usage record not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('stock:' || v_venture_id || ':' || v_material_id));

    SELECT cost_per_unit, remaining_qty INTO v_cost, v_remaining
    FROM cell_material_usage WHERE id = p_usage_id FOR UPDATE;

    IF p_reverse_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot reverse more than remaining %', v_remaining;
    END IF;

    INSERT INTO cell_material_usage_reversals (usage_id, reversed_qty, reason, created_by)
    VALUES (p_usage_id, p_reverse_qty, p_reason, p_created_by);

    v_adjust_id := gen_random_uuid()::text;
    INSERT INTO stock_ledger (id, venture_id, material_id, entry_type, qty,
        cost_per_unit, linked_usage_id, entry_date, created_by, remarks)
    VALUES (v_adjust_id, v_venture_id, v_material_id, 'ADJUST', p_reverse_qty,
        v_cost, p_usage_id, CURRENT_DATE, p_created_by, 'Reversal: ' || COALESCE(p_reason, ''));

    UPDATE cell_material_usage
    SET reversed_qty = reversed_qty + p_reverse_qty
    WHERE id = p_usage_id;

    PERFORM refresh_inventory_alert(v_venture_id, v_material_id);

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 12d. transfer_stock (WAREHOUSE -> venture)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_stock(
    p_to_venture_id TEXT, p_material_id TEXT, p_qty NUMERIC,
    p_transfer_date DATE, p_created_by TEXT
) RETURNS JSONB AS $$
DECLARE
    v_cost NUMERIC;
    v_balance NUMERIC;
    v_out_id TEXT;
    v_in_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('stock:WAREHOUSE:' || p_material_id));
    PERFORM pg_advisory_xact_lock(hashtext('stock:' || p_to_venture_id || ':' || p_material_id));

    SELECT COALESCE(SUM(total_cost) / NULLIF(SUM(qty), 0), 0) INTO v_cost
    FROM stock_ledger
    WHERE venture_id = 'WAREHOUSE' AND material_id = p_material_id AND entry_type = 'IN';

    SELECT balance INTO v_balance
    FROM stock_balance
    WHERE venture_id = 'WAREHOUSE' AND material_id = p_material_id;

    IF COALESCE(v_balance, 0) < p_qty THEN
        RAISE EXCEPTION 'Insufficient warehouse stock: need %, have %', p_qty, COALESCE(v_balance, 0);
    END IF;

    v_out_id := gen_random_uuid()::text;
    INSERT INTO stock_ledger (id, venture_id, material_id, consuming_venture_id,
        entry_type, qty, cost_per_unit, entry_date, created_by)
    VALUES (v_out_id, 'WAREHOUSE', p_material_id, p_to_venture_id,
        'OUT', p_qty, v_cost, p_transfer_date, p_created_by);

    v_in_id := gen_random_uuid()::text;
    INSERT INTO stock_ledger (id, venture_id, material_id, source_venture_id,
        entry_type, qty, cost_per_unit, entry_date, created_by)
    VALUES (v_in_id, p_to_venture_id, p_material_id, 'WAREHOUSE',
        'IN', p_qty, v_cost, p_transfer_date, p_created_by);

    PERFORM refresh_inventory_alert('WAREHOUSE', p_material_id);
    PERFORM refresh_inventory_alert(p_to_venture_id, p_material_id);

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 13. RPC Grants
-- -----------------------------------------------------------
GRANT EXECUTE ON FUNCTION record_cell_usage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION reverse_cell_usage TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION transfer_stock TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION refresh_inventory_alert TO anon, authenticated, service_role;
