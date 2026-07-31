-- Migration: a real games index, so browsing stops scanning the clue table.
--
-- Every search path in searchGames() pulls thousands of CLUE rows and dedupes
-- them in JavaScript to recover a list of GAMES — reading up to 558K rows to
-- produce ~9,300. That's why timeouts keep appearing in new places: text
-- search, difficulty tiers, and the unfiltered "Standard" tier are all the
-- same query shape against the same oversized table.
--
-- This materializes the distinct-games list once (~9,300 rows), with the clue
-- count precomputed. Queries against it are effectively instant and the
-- client-side dedupe becomes unnecessary.
--
-- Refresh after importing new games:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY games_index;

CREATE MATERIALIZED VIEW IF NOT EXISTS games_index AS
SELECT
  game_id_source,
  MIN(game_title)                    AS game_title,
  MIN(air_date)                      AS air_date,
  MIN(player1)                       AS player1,
  MIN(player2)                       AS player2,
  MIN(player3)                       AS player3,
  MIN(season)                        AS season,
  MIN(notes)                         AS notes,
  COUNT(*)::int                      AS clue_count
FROM clue_pool
WHERE game_id_source IS NOT NULL
GROUP BY game_id_source;

-- Unique index is required for REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_index_id
  ON games_index (game_id_source);

CREATE INDEX IF NOT EXISTS idx_games_index_air_date
  ON games_index (air_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_games_index_season
  ON games_index (season);

-- Trigram indexes so ILIKE '%term%' over the browse fields stays fast.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_games_index_title_trgm
  ON games_index USING GIN (game_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_games_index_notes_trgm
  ON games_index USING GIN (notes gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_games_index_players_trgm
  ON games_index USING GIN (
    (coalesce(player1,'') || ' ' || coalesce(player2,'') || ' ' || coalesce(player3,''))
    gin_trgm_ops
  );

ANALYZE games_index;

-- Readable by the anon key, same as clue_pool.
GRANT SELECT ON games_index TO anon, authenticated;
