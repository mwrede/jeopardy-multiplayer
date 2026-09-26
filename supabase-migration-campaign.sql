-- Campaign: one row per night played against real contestants.
--
-- Runs themselves live in the player's browser; this is the shared record —
-- who beat the real contestants, who fell short, and the longest streaks —
-- so the home page can show it. Safe to run twice.

CREATE TABLE IF NOT EXISTS campaign_nights (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         UUID NOT NULL,
    identity_key   TEXT NOT NULL,
    player_name    VARCHAR(40) NOT NULL,
    hometown       VARCHAR(60),
    game_id_source INTEGER NOT NULL,
    aired_on       TEXT,
    size           VARCHAR(8) NOT NULL,
    my_score       INTEGER NOT NULL,
    their_scores   JSONB NOT NULL DEFAULT '[]'::jsonb,
    won            BOOLEAN NOT NULL,
    streak_after   INTEGER NOT NULL,
    winnings_after INTEGER NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_nights_run ON campaign_nights (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_nights_recent ON campaign_nights (created_at DESC);

ALTER TABLE campaign_nights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on campaign_nights" ON campaign_nights;
CREATE POLICY "Allow all on campaign_nights" ON campaign_nights
    FOR ALL USING (true) WITH CHECK (true);
