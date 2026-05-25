-- Migration: Ensure the unique constraint resolve_buzz depends on exists.
--
-- Symptom: clicking the buzzer does nothing. Error in the console / inline
-- under the buzzer reads "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification".
--
-- Root cause: resolve_buzz uses `ON CONFLICT (game_id, clue_id, player_id)`
-- which requires a matching UNIQUE constraint on the buzzes table. Older
-- deployments of supabase-schema.sql missed it, so every buzz errors.
--
-- This migration:
--   1. Dedupes any rows that would block the constraint (keeps the earliest
--      buzz per (game, clue, player), which is what resolve_buzz would have
--      kept anyway via ON CONFLICT DO NOTHING).
--   2. Drops any prior version of the constraint by the same name.
--   3. Re-adds it.

DELETE FROM buzzes
WHERE ctid NOT IN (
  SELECT min(ctid)
  FROM buzzes
  GROUP BY game_id, clue_id, player_id
);

ALTER TABLE buzzes DROP CONSTRAINT IF EXISTS unique_buzz_per_player_clue;
ALTER TABLE buzzes ADD CONSTRAINT unique_buzz_per_player_clue UNIQUE (game_id, clue_id, player_id);
