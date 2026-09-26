-- Run this in the Supabase dashboard SQL editor after `npm run update:jarchive`.
--
-- 1. games_index is a MATERIALIZED view. New clue_pool rows are invisible to
--    the game browser until it is refreshed — the search list would still stop
--    at whatever aired before the import.
-- 2. clues.source_year is what lets a clue show the year it aired. Mashup
--    boards stitch columns from many different shows, so the year has to live
--    on the clue rather than on the game. Safe to run repeatedly.

REFRESH MATERIALIZED VIEW CONCURRENTLY games_index;

ALTER TABLE clues ADD COLUMN IF NOT EXISTS source_year SMALLINT;

-- Sanity check: newest game now in the index.
SELECT game_id_source, game_title, air_date, season
FROM games_index
ORDER BY air_date DESC NULLS LAST
LIMIT 5;
