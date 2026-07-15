-- 00182_lead_inquiries.sql
-- Persists raw inquiry-form submissions (previously only used transiently in
-- the notification email, never stored anywhere) plus AI-generated
-- priority/summary/draft-reply fields for the lead's admin page and the
-- coach notification email.

CREATE TABLE IF NOT EXISTS lead_inquiries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  service               TEXT NOT NULL,
  sport                 TEXT,
  experience            TEXT,
  goals                 TEXT NOT NULL,
  injuries              TEXT,
  how_heard             TEXT,
  gclid                 TEXT,
  ai_priority           TEXT CHECK (ai_priority IN ('high','medium','low')),
  ai_priority_reason    TEXT,
  ai_summary            TEXT,
  ai_draft_reply        TEXT,
  ai_generated_at       TIMESTAMPTZ,
  ai_generation_log_id  UUID REFERENCES ai_generation_log(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_inquiries_lead_user_id ON lead_inquiries(lead_user_id);

ALTER TABLE lead_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all lead inquiries" ON lead_inquiries FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
