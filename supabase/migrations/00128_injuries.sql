-- Injuries: longitudinal injury timeline with rehab milestones
-- =====================================================================
-- Note: days_lost cannot be a GENERATED STORED column because it depends
-- on CURRENT_DATE (non-immutable). Maintained via a trigger instead. The
-- value is refreshed on every UPDATE and on read-paths where the caller
-- wants a fresh count for active injuries; consumers that need a wall-
-- clock-accurate "days since" should compute it client-side.

CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  body_region TEXT NOT NULL CHECK (body_region IN (
    'head','neck','shoulder','elbow','wrist','hand','chest','upper_back','lower_back',
    'hip','glute','hamstring','quad','knee','calf','ankle','foot','other'
  )),
  side TEXT NOT NULL DEFAULT 'n_a' CHECK (side IN ('left','right','bilateral','n_a')),
  injury_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor','moderate','severe')),
  mechanism TEXT,
  description TEXT,

  date_occurred DATE NOT NULL,
  date_resolved DATE,
  days_lost INT NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','recovering','resolved')),
  rehab_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resolved_implies_date CHECK (
    (status = 'resolved' AND date_resolved IS NOT NULL) OR status <> 'resolved'
  )
);

CREATE INDEX idx_injuries_user ON injuries(client_user_id);
CREATE INDEX idx_injuries_user_status ON injuries(client_user_id, status);
CREATE INDEX idx_injuries_user_date ON injuries(client_user_id, date_occurred DESC);

CREATE OR REPLACE FUNCTION compute_injury_days_lost()
RETURNS TRIGGER AS $$
BEGIN
  NEW.days_lost := GREATEST(
    COALESCE(NEW.date_resolved, CURRENT_DATE) - NEW.date_occurred,
    0
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_injury_days_lost
  BEFORE INSERT OR UPDATE OF date_occurred, date_resolved ON injuries
  FOR EACH ROW
  EXECUTE FUNCTION compute_injury_days_lost();

CREATE TRIGGER set_injuries_updated_at
  BEFORE UPDATE ON injuries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE injuries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage injuries"
  ON injuries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Clients can view own injuries"
  ON injuries FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

CREATE POLICY "Clients can insert own injuries"
  ON injuries FOR INSERT TO authenticated
  WITH CHECK (client_user_id = auth.uid());

CREATE POLICY "Clients can update own injuries"
  ON injuries FOR UPDATE TO authenticated
  USING (client_user_id = auth.uid());
