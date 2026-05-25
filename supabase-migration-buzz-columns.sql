-- Migration: Add missing columns to the buzzes table.
--
-- Symptom: errors like "column \"is_pass\" does not exist" or
-- "column \"answer\" does not exist" when buzzing or viewing buzz order.
--
-- Root cause: older deployments created the buzzes table from a pre-final
-- schema that was missing later-added columns. These ADD COLUMN IF NOT
-- EXISTS lines bring an existing buzzes table up to current shape without
-- losing data.

ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS is_pass BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS answer TEXT;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS is_correct BOOLEAN;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS adjusted_time TIMESTAMPTZ;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS latency_offset SMALLINT;
ALTER TABLE buzzes ADD COLUMN IF NOT EXISTS client_timestamp DOUBLE PRECISION;
