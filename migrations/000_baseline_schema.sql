-- ============================================================
-- Migration 000: Baseline schema
-- Run this FIRST in a fresh/empty Supabase database.
-- Creates the original JSONB tables that later migrations upgrade.
-- All statements use IF NOT EXISTS — safe to re-run.
-- This does NOT delete any data (there is no data yet in a fresh DB).
-- ============================================================

-- Core tracking table: one row per cell, keyed by block/floor/flat/work-item
CREATE TABLE IF NOT EXISTS cell_data (
    id   TEXT PRIMARY KEY,
    data JSONB
);

-- Venture master list
CREATE TABLE IF NOT EXISTS ventures (
    id   TEXT PRIMARY KEY,
    data JSONB
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id   TEXT PRIMARY KEY,
    data JSONB
);

-- Purchase orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id   TEXT PRIMARY KEY,
    data JSONB
);

-- Vendor directory
CREATE TABLE IF NOT EXISTS vendors (
    id   TEXT PRIMARY KEY,
    data JSONB
);

-- App settings / key-value store
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value JSONB
);
