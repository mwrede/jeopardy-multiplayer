-- Remember which year each clue originally aired.
--
-- A board pulled from one real episode has a single air date, but a mashup
-- board is made of columns from many different shows — so the year has to live
-- on the clue, not the game. Populated at board-build time from
-- clue_pool.air_date; NULL for custom boards, which never aired.
--
-- Safe to run twice. The app works without it (no year is shown until it runs).

ALTER TABLE clues ADD COLUMN IF NOT EXISTS source_year SMALLINT;
