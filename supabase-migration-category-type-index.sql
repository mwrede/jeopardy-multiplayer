-- Migration: index category_type so themed boards stop timing out.
--
-- Clicking a curated category chip (Geography, Corporate, History, …) runs
--   WHERE round = 'Jeopardy Round' AND category_type = 'geography'
-- and category_type had NO index at all. The planner could only use
-- idx_clue_pool_round, which narrows to roughly half of the 558K rows, then
-- filtered category_type by scanning every one of them — long enough to trip
-- "canceling statement due to statement timeout".
--
-- The composite matches that access pattern exactly: category_type first
-- (highly selective), round second. It also covers the existing themed
-- mashups, which issue the same query shape.
--
-- Idempotent and fast — a plain btree, not a trigram index, so this builds in
-- seconds rather than minutes.

CREATE INDEX IF NOT EXISTS idx_clue_pool_type_round
  ON clue_pool (category_type, round);

-- Final Jeopardy theme lookups filter on category_type alone.
CREATE INDEX IF NOT EXISTS idx_clue_pool_category_type
  ON clue_pool (category_type);

ANALYZE clue_pool;
