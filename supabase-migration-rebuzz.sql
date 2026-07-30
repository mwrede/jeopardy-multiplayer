-- Migration: make the buzzer work when the window REOPENS after a wrong answer.
--
-- Two bugs made a reopened buzz window dead:
--
--   1. resolve_buzz's fast path returned early whenever ANY row for the clue
--      had is_winner = TRUE. After a wrong answer that flag is still set on
--      the player who just missed, so every later buzz was recorded as a
--      loser and the game never moved to player_answering. Nothing happened
--      when you hit the buzzer.
--
--   2. Even with that cleared, the winner was chosen as the earliest
--      server_timestamp across ALL non-pass buzzes — which re-selects the
--      player who already answered wrong, since they buzzed first originally.
--
-- The fix in both places: a player is out for this clue once they've attempted
-- it, which is exactly `is_correct IS NOT NULL`. Only untried players can hold
-- or win the buzz. Attempting also can't be re-entered, so a wrong answerer
-- can't buzz back in.
--
-- Also adds games.buzz_window_ms so whoever opens a window can declare how
-- long it runs — reopened windows are shorter than the first one.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS buzz_window_ms INTEGER;

COMMENT ON COLUMN games.buzz_window_ms IS
  'Duration of the CURRENT buzz window in ms. Reopened windows are shorter than the initial one. NULL = fall back to settings.buzz_window_ms.';

CREATE OR REPLACE FUNCTION resolve_buzz(
  p_game_id UUID,
  p_clue_id UUID,
  p_player_id UUID,
  p_client_timestamp DOUBLE PRECISION DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_winner UUID;
  v_winner_id UUID;
  v_already_tried BOOLEAN;
BEGIN
  -- 0. A player who already answered this clue is out. Record nothing, win nothing.
  SELECT EXISTS (
    SELECT 1 FROM buzzes
     WHERE game_id = p_game_id
       AND clue_id = p_clue_id
       AND player_id = p_player_id
       AND is_correct IS NOT NULL
  ) INTO v_already_tried;

  IF v_already_tried THEN
    RETURN FALSE;
  END IF;

  -- 1. Is someone currently holding the buzz? Only an UNTRIED winner counts —
  --    a stale is_winner from a player who already missed must not block others.
  SELECT player_id INTO v_existing_winner
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_winner = TRUE
     AND is_correct IS NULL
   LIMIT 1;

  IF v_existing_winner IS NOT NULL THEN
    INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
    VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
    ON CONFLICT (game_id, clue_id, player_id) DO NOTHING;

    RETURN (v_existing_winner = p_player_id);
  END IF;

  -- 2. Window is open. Record this buzz. On a reopen the player may already
  --    have a row from the first window, so refresh its timestamps — ordering
  --    should reflect THIS window's race, not the earlier one.
  INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
  VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
  ON CONFLICT (game_id, clue_id, player_id) DO UPDATE
    SET client_timestamp = EXCLUDED.client_timestamp,
        server_timestamp = now();

  -- 3. Earliest untried buzzer wins.
  SELECT player_id INTO v_winner_id
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_pass = FALSE
     AND is_correct IS NULL
   ORDER BY server_timestamp ASC, client_timestamp ASC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  -- 4. Clear any stale winner flag, then mark the new one.
  UPDATE buzzes
     SET is_winner = FALSE
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_winner = TRUE;

  UPDATE buzzes
     SET is_winner = TRUE
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND player_id = v_winner_id;

  -- 5. Hand the mic over.
  UPDATE games
     SET phase = 'player_answering',
         current_player_id = v_winner_id,
         buzz_window_open = FALSE,
         updated_at = now()
   WHERE id = p_game_id;

  RETURN (v_winner_id = p_player_id);
END;
$$;
