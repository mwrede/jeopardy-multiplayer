-- Migration: true re-buzz on a wrong answer + a server-clock buzzer open
--
-- TWO CHANGES, both needed together.
--
-- 1. resolve_buzz: a wrong answer now REOPENS the buzzers for everyone who
--    hasn't tried yet, instead of handing the clue down a pre-recorded queue
--    of whoever buzzed first. That's how the show works — the buzzers come
--    back on and it's a fresh race.
--
--    The old function couldn't support that. It short-circuited on any row
--    with is_winner = TRUE, so once the first buzzer had won nobody could win
--    again; and it picked the winner by earliest timestamp across ALL buzzes
--    for the clue, so the player who had just answered wrong — whose buzz is
--    by definition the earliest — would win the reopened window every time.
--
--    Now a player who has already attempted (is_correct IS NOT NULL) is out of
--    the running, and an existing winner only blocks while their attempt is
--    still pending.
--
-- 2. open_buzz_window: sets buzz_window_start from the DATABASE clock rather
--    than from whichever browser happened to flip the phase. Every device
--    arms off that timestamp, so one player's wrong system clock no longer
--    shifts the start for the whole room.

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
  v_already_tried BOOLEAN;
  v_pending_winner UUID;
  v_winner_id UUID;
BEGIN
  -- Already had a go at this clue? Then this buzz doesn't count. Without this
  -- the reopened window would just be won by the same person again.
  SELECT TRUE INTO v_already_tried
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND player_id = p_player_id
     AND is_correct IS NOT NULL
   LIMIT 1;

  IF v_already_tried THEN
    RETURN FALSE;
  END IF;

  -- Someone holding the buzz right now, not yet judged, blocks everyone else.
  -- A winner who has already answered does NOT block: that's the reopen.
  SELECT player_id INTO v_pending_winner
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_winner = TRUE
     AND is_correct IS NULL
   LIMIT 1;

  IF v_pending_winner IS NOT NULL THEN
    INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
    VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
    ON CONFLICT (game_id, clue_id, player_id) DO NOTHING;
    RETURN (v_pending_winner = p_player_id);
  END IF;

  INSERT INTO buzzes (game_id, clue_id, player_id, client_timestamp, is_winner)
  VALUES (p_game_id, p_clue_id, p_player_id, p_client_timestamp, FALSE)
  ON CONFLICT (game_id, clue_id, player_id) DO UPDATE
    SET client_timestamp = EXCLUDED.client_timestamp,
        server_timestamp = now(),
        is_winner        = FALSE;

  -- Earliest buzz wins, counting only players still eligible to answer.
  SELECT player_id INTO v_winner_id
    FROM buzzes
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND is_pass = FALSE
     AND is_correct IS NULL
   ORDER BY server_timestamp ASC, client_timestamp ASC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  UPDATE buzzes
     SET is_winner = TRUE
   WHERE game_id = p_game_id
     AND clue_id = p_clue_id
     AND player_id = v_winner_id;

  -- Hand the clue to the winner regardless of who made this call: the caller
  -- may have lost the race to someone whose buzz landed a moment earlier, and
  -- the game still has to move to that player.
  UPDATE games
     SET phase             = 'player_answering',
         current_player_id = v_winner_id,
         buzz_window_open  = FALSE,
         updated_at        = now()
   WHERE id = p_game_id;

  RETURN (v_winner_id = p_player_id);
END;
$$;

-- Open the buzzers on the database's clock, with a small lead so every device
-- has time to receive the change and arm on the same instant.
CREATE OR REPLACE FUNCTION open_buzz_window(
  p_game_id UUID,
  p_lead_ms INTEGER DEFAULT 700,
  p_window_ms INTEGER DEFAULT NULL,
  -- Every screen races to open the buzzers; the guard means a straggler can't
  -- reopen them after the clue has already moved on.
  p_only_if_reading BOOLEAN DEFAULT FALSE
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
  v_start TIMESTAMPTZ;
BEGIN
  UPDATE games
     SET phase             = 'buzz_window',
         buzz_window_open  = TRUE,
         buzz_window_start = now() + (p_lead_ms || ' milliseconds')::interval,
         buzz_window_ms    = COALESCE(p_window_ms, buzz_window_ms),
         updated_at        = now()
   WHERE id = p_game_id
     AND (NOT p_only_if_reading OR phase = 'clue_reading')
  RETURNING buzz_window_start INTO v_start;

  RETURN v_start;
END;
$$;
