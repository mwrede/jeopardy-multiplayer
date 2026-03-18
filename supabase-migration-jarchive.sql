-- Migration: Add J-Archive metadata columns to clue_pool
-- Run this in your Supabase SQL Editor before seeding J-Archive data

-- Add new columns for game metadata
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS air_date DATE;
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS game_title VARCHAR(200);
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS player1 VARCHAR(100);
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS player2 VARCHAR(100);
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS player3 VARCHAR(100);
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS is_daily_double BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS season VARCHAR(30);
ALTER TABLE clue_pool ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add index on air_date for date-based queries
CREATE INDEX IF NOT EXISTS idx_clue_pool_air_date ON clue_pool(air_date);
CREATE INDEX IF NOT EXISTS idx_clue_pool_game_id_source ON clue_pool(game_id_source);
CREATE INDEX IF NOT EXISTS idx_clue_pool_season ON clue_pool(season);
