-- Add purpose_venture_id to stock_ledger for tracking material usage per venture
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='stock_ledger' AND column_name='purpose_venture_id') THEN
        ALTER TABLE stock_ledger ADD COLUMN purpose_venture_id TEXT;
    END IF;
END $$;
