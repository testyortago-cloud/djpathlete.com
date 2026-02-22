-- Add visibility column to programs table
-- Default false so AI-generated programs are private (only visible to assigned client)
ALTER TABLE programs
  ADD COLUMN is_public boolean NOT NULL DEFAULT false;
