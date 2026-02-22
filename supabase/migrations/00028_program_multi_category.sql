-- Drop all check constraints on the category column first
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'public.programs'::regclass
      AND att.attname = 'category'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.programs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Convert programs.category from text to text[] for multi-select support
ALTER TABLE programs
  ALTER COLUMN category TYPE text[]
  USING ARRAY[category];

-- Add new constraint to validate array elements
ALTER TABLE programs ADD CONSTRAINT programs_category_check
  CHECK (category <@ ARRAY['strength', 'conditioning', 'sport_specific', 'recovery', 'nutrition', 'hybrid']::text[]);
