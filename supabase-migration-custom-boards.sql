-- Custom boards table: stores user-created Jeopardy boards as reusable templates
CREATE TABLE IF NOT EXISTS custom_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(100) NOT NULL,
  board_data JSONB NOT NULL,        -- CustomBoard JSON (rounds + finalJeopardy)
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for browsing/searching by title
CREATE INDEX IF NOT EXISTS idx_custom_boards_title ON custom_boards (title);
CREATE INDEX IF NOT EXISTS idx_custom_boards_public ON custom_boards (is_public, created_at DESC);

-- Enable realtime (optional)
ALTER TABLE custom_boards REPLICA IDENTITY FULL;

-- RLS policies
ALTER TABLE custom_boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read public custom boards" ON custom_boards FOR SELECT USING (is_public = true);
CREATE POLICY "Anyone can insert custom boards" ON custom_boards FOR INSERT WITH CHECK (true);
