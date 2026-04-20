-- supabase/migrations/00075_prompt_templates.sql
CREATE TABLE prompt_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN (
                  'structure', 'session', 'periodization',
                  'sport', 'rehab', 'conditioning', 'specialty'
                )),
  scope         text NOT NULL CHECK (scope IN ('week', 'day', 'both')),
  description   text NOT NULL,
  prompt        text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prompt_templates_scope ON prompt_templates(scope);
CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX idx_prompt_templates_updated ON prompt_templates(updated_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_prompt_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prompt_templates_updated_at
  BEFORE UPDATE ON prompt_templates
  FOR EACH ROW EXECUTE FUNCTION set_prompt_templates_updated_at();

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
