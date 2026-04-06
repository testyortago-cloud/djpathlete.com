-- Expand the program_exercises technique check to include new AI-generated techniques
ALTER TABLE program_exercises DROP CONSTRAINT IF EXISTS program_exercises_technique_check;

ALTER TABLE program_exercises ADD CONSTRAINT program_exercises_technique_check
  CHECK (technique IN (
    'straight_set', 'superset', 'dropset', 'giant_set',
    'circuit', 'rest_pause', 'amrap', 'cluster_set',
    'complex', 'emom', 'wave_loading'
  ));
