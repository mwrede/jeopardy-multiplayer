-- Migration: Trigram GIN indexes so ILIKE on clue_pool metadata is fast.
-- Lets the host /search tab query game_title, notes, and player names
-- without timing out on the 558K-row clue_pool table.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clue_pool_game_title_trgm
  ON clue_pool USING GIN (game_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clue_pool_notes_trgm
  ON clue_pool USING GIN (notes gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clue_pool_player1_trgm
  ON clue_pool USING GIN (player1 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clue_pool_player2_trgm
  ON clue_pool USING GIN (player2 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clue_pool_player3_trgm
  ON clue_pool USING GIN (player3 gin_trgm_ops);
