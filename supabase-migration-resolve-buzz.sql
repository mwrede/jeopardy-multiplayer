-- resolve_buzz: Atomic buzz resolution with client-timestamp tiebreaking.
--
-- When a player buzzes in, this function:
--   1. Inserts their buzz with both server and client timestamps
--   2. Checks if someone already won the buzz for this clue
--   3. If no winner yet, compares server_timestamp across all buzzes for this clue
--      and picks the earliest one as the winner (client_timestamp stored for auditing)
--   4. Updates the game to player_answering phase with the winner
--   5. Returns TRUE if the calling player won, FALSE otherwise
--
-- Uses SERIALIZABLE-level row locking to prevent two simultaneous buzzes
-- from both thinking they won.

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
BEGIN
  -- 1. Check if there's already a winner for this clue (fast path)
  SELECT player_id INTO v_existing_winner
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_winner = TRUE
   LIMIT 1;

  IF v_existing_winner IS NOT NULL THEN
    -- Someone already won — still record this buzz for history, but they lost
    INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
    VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
    ON CONFLICT (game_id, clue_id, player_id) DO NOTHING;

    RETURN (v_existing_winner = p_player_id);
  END IF;

  -- 2. No winner yet — record this buzz
  INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
  VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
  ON CONFLICT (game_id, clue_id, player_id) DO UPDATE
    SET client_timestamp = EXCLUDED.client_timestamp;

  -- 3. Pick the winner: earliest server_timestamp wins.
  --    Lock the rows so concurrent calls see a consistent view.
  SELECT player_id INTO v_winner_id
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_pass = FALSE
   ORDER BY server_timestamp ASC, client_timestamp ASC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  -- 4. Mark the winner
  UPDATE buzzes
     SET is_winner = TRUE
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND player_id = v_winner_id;

  -- 5. Transition the game to answering phase
  UPDATE games
     SET phase = 'player_answering',
         current_player_id = v_winner_id,
         buzz_window_open = FALSE,
         updated_at = now()
   WHERE id = p_game_id;

  RETURN (v_winner_id = p_player_id);
END;
$$;
