-- Migration: Trigram GIN index on clue_pool.category
--
-- The Topic Mashup feature lets users type a free-text term and pick
-- categories whose name matches via ILIKE '%term%'. Without this index
-- Postgres scans 558K rows; with it, the lookup is sub-second.
--
-- Idempotent: pg_trgm is created IF NOT EXISTS, and the index is too.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clue_pool_category_trgm
  ON clue_pool USING GIN (category gin_trgm_ops);
