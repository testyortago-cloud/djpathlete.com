-- Convert exercises.category from text (with CHECK constraint) to text[] array
-- to support multi-category exercises (e.g. Kettlebell Swing = strength + cardio).

-- Drop the existing CHECK constraint first
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_category_check;

-- Convert column from text to text[], wrapping existing values in arrays
ALTER TABLE public.exercises
  ALTER COLUMN category TYPE text[]
  USING ARRAY[category];
