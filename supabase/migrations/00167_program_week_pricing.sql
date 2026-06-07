-- Program-level premium-week template.
-- A row means "week N of this program is a paid add-on at price_cents".
-- Absence of a row = that week is included with program entry.
CREATE TABLE program_week_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number integer NOT NULL CHECK (week_number >= 1),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, week_number)
);

CREATE INDEX idx_week_pricing_program ON program_week_pricing(program_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON program_week_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
