-- Phase 1.5a — Marketing attribution capture
-- Stores tracking params (gclid, utm_*, etc.) per visitor session, joined to user_id at action time.

CREATE TABLE marketing_attribution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL UNIQUE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  gclid           text,
  gbraid          text,
  wbraid          text,
  fbclid          text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  landing_url     text,
  referrer        text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_attr_user ON marketing_attribution(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_marketing_attr_gclid ON marketing_attribution(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_marketing_attr_unclaimed ON marketing_attribution(session_id) WHERE claimed_at IS NULL;

-- gclid back-fill columns on action tables
ALTER TABLE bookings              ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE payments              ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE event_signups         ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;

CREATE INDEX IF NOT EXISTS idx_bookings_gclid             ON bookings(gclid)              WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_gclid           ON newsletter_subscribers(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_gclid             ON payments(gclid)              WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_signups_gclid        ON event_signups(gclid)         WHERE gclid IS NOT NULL;

-- RLS: only service role writes; authenticated users can SELECT their own attribution rows
ALTER TABLE marketing_attribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on marketing_attribution"
  ON marketing_attribution FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own marketing_attribution"
  ON marketing_attribution FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all marketing_attribution"
  ON marketing_attribution FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
