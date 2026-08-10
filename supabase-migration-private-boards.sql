-- Migration: let authors read their own private boards.
--
-- The SELECT policy was `USING (is_public = true)`, so a private board became
-- unreadable the instant it was written — including to the person who just
-- wrote it. Concretely:
--
--   · Saving a private board threw "Cannot coerce the result to a single JSON
--     object": the INSERT succeeded, but the `.select(...).single()` that reads
--     the new row back returned zero rows because the policy filtered it.
--   · loadCustomBoard could never re-open a private board, so it couldn't be
--     edited again.
--   · updateCustomBoard failed the same way on every save.
--
-- There's no ownership to enforce against for anonymous boards
-- (creator_user_id is null for them), and UPDATE/DELETE are already open to
-- anyone. Gating SELECT alone bought no protection — it only broke the author.
--
-- So `is_public` now means UNLISTED rather than secret: private boards don't
-- appear in the browser (listCustomBoards filters on is_public), but anyone
-- holding the id can open one. That's the behaviour the share links already
-- assumed.

DROP POLICY IF EXISTS "Anyone can read public custom boards" ON custom_boards;

CREATE POLICY "Anyone can read custom boards"
  ON custom_boards FOR SELECT
  USING (true);
