-- Add answered_correct column to clues table
-- Tracks whether the answerer got it right or wrong
ALTER TABLE clues ADD COLUMN IF NOT EXISTS answered_correct BOOLEAN DEFAULT NULL;
