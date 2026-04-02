-- Per-week payment access control
-- Allows admin to charge per-week for programs instead of one lump sum

CREATE TABLE program_week_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES program_assignments(id) ON DELETE CASCADE,
  week_number integer NOT NULL CHECK (week_number >= 1),
  access_type text NOT NULL DEFAULT 'included' CHECK (access_type IN ('included', 'paid')),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  payment_status text NOT NULL DEFAULT 'not_required' CHECK (payment_status IN ('not_required', 'pending', 'paid')),
  stripe_session_id text,
  stripe_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assignment_id, week_number)
);

-- Index for fast lookup by assignment
CREATE INDEX idx_week_access_assignment ON program_week_access(assignment_id);

-- Apply the shared updated_at trigger
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON program_week_access
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
