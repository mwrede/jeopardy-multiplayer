-- Migration: in-game chat.
--
-- Its own table rather than realtime broadcast, so the conversation survives a
-- reload: Community Play is with strangers on their own phones, and a player
-- whose tab reloads mid-game shouldn't come back to an empty room. Rows die
-- with the game (ON DELETE CASCADE).
--
-- Until this is run the chat button doesn't appear at all — the client checks
-- for the table and hides itself rather than erroring.

CREATE TABLE IF NOT EXISTS chat_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id      UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    -- Kept even if the player row goes, so their messages don't vanish
    -- mid-conversation when they leave.
    player_id    UUID REFERENCES players(id) ON DELETE SET NULL,
    player_name  VARCHAR(40)  NOT NULL,
    body         VARCHAR(300) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT chat_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_game
    ON chat_messages (game_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Same permissive policy as every other game table: the app runs on the anon
-- key and a room code is the only credential there is.
DROP POLICY IF EXISTS "Allow all on chat_messages" ON chat_messages;
CREATE POLICY "Allow all on chat_messages" ON chat_messages
    FOR ALL USING (true) WITH CHECK (true);

-- Server-push, so a message lands without waiting for the next poll.
-- Wrapped because ADD TABLE errors if it's already published — this file
-- should be safe to paste twice.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
