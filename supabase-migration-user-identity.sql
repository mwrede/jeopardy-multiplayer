-- Migration: User identity (Supabase Auth) for profiles, ownership, and stats
--
-- Adds:
--   - profiles table (display name keyed to auth.users)
--   - players.user_id   (so we can compute "games played" / "opponents" per user)
--   - custom_boards.creator_user_id (so editing/deleting is owner-only)
--
-- Tightens custom_boards RLS — owner-only update/delete, replacing the earlier
-- "anyone can update/delete" policies. Legacy boards (NULL creator) become
-- read-only.

CREATE TABLE IF NOT EXISTS profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read profiles"
  ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players (user_id);

ALTER TABLE custom_boards ADD COLUMN IF NOT EXISTS creator_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_custom_boards_creator ON custom_boards (creator_user_id);

DROP POLICY IF EXISTS "Anyone can update custom boards" ON custom_boards;
DROP POLICY IF EXISTS "Anyone can delete custom boards" ON custom_boards;

CREATE POLICY "Owner can update custom boards"
  ON custom_boards FOR UPDATE
  USING (auth.uid() = creator_user_id)
  WITH CHECK (auth.uid() = creator_user_id);

CREATE POLICY "Owner can delete custom boards"
  ON custom_boards FOR DELETE
  USING (auth.uid() = creator_user_id);
