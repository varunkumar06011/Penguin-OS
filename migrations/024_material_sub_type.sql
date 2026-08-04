-- Add sub_type column to materials table for linking to inventory_categories types
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='sub_type') THEN
        ALTER TABLE materials ADD COLUMN sub_type TEXT;
    END IF;
END $$;
