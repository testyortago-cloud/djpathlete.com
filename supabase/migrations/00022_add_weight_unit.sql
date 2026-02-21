-- Add weight unit preference to client profiles (kg or lbs)
-- Database always stores weights in kg; this controls display only.
ALTER TABLE client_profiles
  ADD COLUMN weight_unit text NOT NULL DEFAULT 'lbs'
    CHECK (weight_unit IN ('kg', 'lbs'));
