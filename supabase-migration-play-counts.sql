-- Migration: Track how often each game / mashup / custom board has been played
-- so the GameBrowser can default to "most played first".

CREATE TABLE IF NOT EXISTS play_counts (
  kind        TEXT NOT NULL CHECK (kind IN ('game', 'mashup', 'custom')),
  key         TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_play_counts_kind_count
  ON play_counts (kind, count DESC);

ALTER TABLE play_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read play_counts"
  ON play_counts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert play_counts"
  ON play_counts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update play_counts"
  ON play_counts FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION increment_play_count(p_kind TEXT, p_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO play_counts (kind, key, count)
  VALUES (p_kind, p_key, 1)
  ON CONFLICT (kind, key)
  DO UPDATE SET count = play_counts.count + 1, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION increment_play_count(TEXT, TEXT) TO anon, authenticated;
