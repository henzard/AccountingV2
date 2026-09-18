-- Migration: Add transaction_hash for CSV import deduplication
-- Created: 2026-09-18

-- Add transaction_hash column for idempotent CSV imports
ALTER TABLE transactions ADD COLUMN transaction_hash TEXT;

-- Create index for efficient duplicate lookups during import
CREATE INDEX IF NOT EXISTS transactions_hash_idx ON transactions(household_id, transaction_hash);
