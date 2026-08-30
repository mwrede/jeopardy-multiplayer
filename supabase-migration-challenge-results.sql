-- Migration: Jeopardy Challenge results.
--
-- The challenge boards themselves live in the repo (src/lib/challenge-data.ts)
-- so every player sees identical clues; this table records only how each
-- person's one attempt went.
--
-- identity_key is 'user:<auth uuid>' for signed-in players and
-- 'guest:<browser uuid>' for guests. The unique constraint IS the one-play
-- rule — a second insert for the same board and person fails, whatever tab or
-- device it comes from.
--
-- clue_results keeps the clue-by-clue record:
--   [{"c": 0, "r": 1, "outcome": "correct" | "wrong" | "pass", "value": 400}, ...]
-- (c = category index, r = row index on the 3x3 board). It's what lets later
-- players race this person as a ghost and see, clue by clue, who got what.

CREATE TABLE challenge_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_key      TEXT NOT NULL,
    identity_key  TEXT NOT NULL,
    user_id       UUID,
    player_name   VARCHAR(30) NOT NULL,
    score         INTEGER NOT NULL,
    correct_count SMALLINT NOT NULL DEFAULT 0,
    clue_results  JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT one_play_per_board UNIQUE (game_key, identity_key)
);

CREATE INDEX idx_challenge_results_game_score ON challenge_results(game_key, score DESC);
CREATE INDEX idx_challenge_results_identity ON challenge_results(identity_key);

ALTER TABLE challenge_results ENABLE ROW LEVEL SECURITY;

-- Anyone can read (leaderboards are public) and anyone can record a finished
-- game (guests play too). No update or delete policy at all: a played board
-- is final, which is the whole point of a one-shot challenge.
CREATE POLICY "Anyone can read challenge results"
  ON challenge_results FOR SELECT USING (true);
CREATE POLICY "Anyone can record a challenge result"
  ON challenge_results FOR INSERT WITH CHECK (true);
