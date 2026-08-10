-- Migration: pre-game voting for Community Play.
--
-- Three players pick the board size, difficulty and era before the game
-- starts. Votes live on the players row rather than in games.settings so each
-- player writes only their own record — a shared JSON column would have three
-- clients clobbering each other's writes.

ALTER TABLE players ADD COLUMN IF NOT EXISTS vote_size       TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS vote_difficulty TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS vote_decade     TEXT;

COMMENT ON COLUMN players.vote_size IS 'full | half | rapid';
COMMENT ON COLUMN players.vote_difficulty IS 'kids | teen | college | standard';
COMMENT ON COLUMN players.vote_decade IS 'any | 1980s | 1990s | 2000s | 2010s | 2020s';
