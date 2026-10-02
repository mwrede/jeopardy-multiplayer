-- Migration: Board of the Day results.
--
-- The boards themselves live in the repo (src/lib/daily-data.ts, over the
-- frozen clues in challenge-boards.json), so everyone plays identical clues on
-- a given date. This table records only how each person's single attempt went.
--
-- play_date is the player's local calendar date, as the client saw it. That is
-- deliberate: a daily board that changed at UTC midnight would change in the
-- middle of a US evening.
--
-- identity_key is 'user:<auth uuid>' when signed in and 'guest:<browser uuid>'
-- otherwise — the same identity the Challenge uses. The unique constraint IS
-- the one-shot rule: a second insert for the same person on the same date
-- fails, whatever tab or device it comes from, and a day is never replayable.
--
-- clue_results keeps all nineteen:
--   [{"rd": 1, "c": 0, "r": 1, "outcome": "correct" | "wrong" | "pass", "value": 400}, ...]
-- rd 1 = Jeopardy, 2 = Double Jeopardy, 3 = Final (c and r are 0 there and
-- value is the wager); c = category 0-2, r = row 0-2. It is what draws the
-- shareable grid.
--
-- Safe to run once. Nothing else needs changing: the front page plays the
-- board with or without this table and only the standings wait on it.

CREATE TABLE IF NOT EXISTS daily_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    play_date     DATE NOT NULL,
    board_key     TEXT NOT NULL,
    identity_key  TEXT NOT NULL,
    user_id       UUID,
    player_name   VARCHAR(30) NOT NULL,
    score         INTEGER NOT NULL,
    correct_count SMALLINT NOT NULL DEFAULT 0,
    clue_results  JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT one_play_per_day UNIQUE (play_date, identity_key)
);

-- Today's board, best first: the leaderboard beside the board.
CREATE INDEX IF NOT EXISTS idx_daily_results_date_score ON daily_results(play_date, score DESC);
-- One person's every day, for their streak and their all-time total.
CREATE INDEX IF NOT EXISTS idx_daily_results_identity ON daily_results(identity_key, play_date DESC);

ALTER TABLE daily_results ENABLE ROW LEVEL SECURITY;

-- Anyone can read (the standings are public) and anyone can record a finished
-- day (guests play too). No UPDATE and no DELETE policy at all: a played day
-- is final, which is the whole point of one shot.
DROP POLICY IF EXISTS "Anyone can read daily results" ON daily_results;
CREATE POLICY "Anyone can read daily results"
  ON daily_results FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can record a daily result" ON daily_results;
CREATE POLICY "Anyone can record a daily result"
  ON daily_results FOR INSERT WITH CHECK (true);
