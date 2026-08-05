-- 025_cell_data_indexes.sql
-- Add indexes on cell_data JSONB columns to speed up /api/cells queries
-- The /api/cells endpoint filters on data->>venture_id and data->>block
-- Without indexes these are full table scans on large datasets

-- GIN index on the full data column (supports @> containment queries)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cell_data' AND indexname = 'idx_cell_data_gin'
    ) THEN
        CREATE INDEX idx_cell_data_gin ON cell_data USING GIN (data);
    END IF;
END $$;

-- Expression index on data->>venture_id (used by /api/cells filter)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cell_data' AND indexname = 'idx_cell_data_venture_id'
    ) THEN
        CREATE INDEX idx_cell_data_venture_id ON cell_data ((data->>'venture_id'));
    END IF;
END $$;

-- Expression index on data->>block (used by /api/cells filter)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cell_data' AND indexname = 'idx_cell_data_block'
    ) THEN
        CREATE INDEX idx_cell_data_block ON cell_data ((data->>'block'));
    END IF;
END $$;

-- Composite expression index for the common query: WHERE data->>venture_id = ? AND data->>block = ?
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cell_data' AND indexname = 'idx_cell_data_venture_block'
    ) THEN
        CREATE INDEX idx_cell_data_venture_block ON cell_data ((data->>'venture_id'), (data->>'block'));
    END IF;
END $$;
