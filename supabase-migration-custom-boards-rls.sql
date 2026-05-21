-- Migration: Allow updates and deletes on custom_boards.
-- The original migration only granted SELECT (public) and INSERT, so
-- updateCustomBoard / deleteCustomBoard were silently blocked by RLS.
-- This opens up edit + delete to anyone since there is no auth/owner column.

CREATE POLICY "Anyone can update custom boards"
  ON custom_boards FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete custom boards"
  ON custom_boards FOR DELETE
  USING (true);
