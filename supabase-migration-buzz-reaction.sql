-- Migration: record HOW LONG each player took to buzz, and rank buzzes by that
-- rather than by which packet reached the database first.
--
-- WHY
--
-- The buzzers are supposed to open for everyone at the same instant. In
-- practice they don't: a phone that misses the realtime push waits for the
-- 2-second polling fallback, so it can arm a second or two after the rest of
-- the room. Under the old rule — earliest arrival at the database wins — that
-- player could react faster than everybody and still lose every clue, which
-- is the single most annoying thing a buzzer can do.
--
-- Now each device times ITSELF: the gap between the moment its own buzzer
-- armed and the moment it was pressed, measured on one monotonic clock that
-- never leaves the device. That number is the buzz. Whoever reacted quickest
-- wins the clue no matter how slow their phone or their wifi is, and the same
-- number is what the room sees afterwards ("0.42s") and what the end-of-game
-- buzzer report is built from.
--
-- Resolution moved into the app (src/lib/game-api.ts): buzzes are collected
-- for a short window after the first one lands, then the lowest reaction wins.
-- The winner is claimed with a phase-guarded UPDATE, so if two devices try to
-- resolve the same race at once only one lands and the other sees the game has
-- already moved on. resolve_buzz stays in the database untouched — it's the
-- fallback path for a deployment that hasn't run this migration yet.
--
-- Everything below is additive and safe to re-run.

ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS reaction_ms INTEGER;

COMMENT ON COLUMN buzzes.reaction_ms IS
  'Milliseconds from the buzzer arming on that player''s own device to them pressing it. Device-local and monotonic, so it is comparable across players regardless of clock skew or network lag. NULL for passes and for buzzes recorded before this column existed.';

-- The buzz report reads every buzz in a game at once.
CREATE INDEX IF NOT EXISTS idx_buzzes_game ON buzzes(game_id);
