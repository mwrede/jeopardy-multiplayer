-- Migration: Trigram GIN indexes on clue_pool.question and clue_pool.answer.
--
-- The Topic Board builder lets users type arbitrary category headers
-- ("mechanical engineering", "the Beatles") and pulls any clue that mentions
-- the term — matching the category name OR the clue text OR the answer.
-- Without these indexes, ILIKE '%term%' over question/answer scans all 558K
-- rows and trips the statement timeout.
--
-- Idempotent: pg_trgm is created IF NOT EXISTS, and so are the indexes.
-- Note: building these on a large table takes a minute or two.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clue_pool_question_trgm
  ON clue_pool USING GIN (question gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clue_pool_answer_trgm
  ON clue_pool USING GIN (answer gin_trgm_ops);
