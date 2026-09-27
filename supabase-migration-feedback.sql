-- Migration: player feedback.
--
-- Asked for at the end of a game, when the player knows exactly what was fun
-- and what was annoying. Anyone can leave a note; nobody but the dashboard
-- reads them back (a note can carry an email address, so the anon key gets
-- INSERT and nothing else).
--
-- Until this is run the card still shows; a failed send falls back to a
-- mailto link with the text already in it.

CREATE TABLE IF NOT EXISTS feedback (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- "user:<uid>" for an account, a per-browser guest id otherwise.
    identity_key  TEXT,
    player_name   VARCHAR(60),
    -- Which game they'd just finished: party, multiplayer, community,
    -- challenge, campaign.
    mode          VARCHAR(24)   NOT NULL,
    page          TEXT,
    message       VARCHAR(2000) NOT NULL,
    -- Optional; an email if they'd like a reply.
    contact       VARCHAR(200),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT feedback_not_blank CHECK (length(btrim(message)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can leave feedback" ON feedback;
CREATE POLICY "Anyone can leave feedback" ON feedback
    FOR INSERT WITH CHECK (true);
