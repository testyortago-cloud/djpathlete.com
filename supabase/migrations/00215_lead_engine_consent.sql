-- supabase/migrations/00215_lead_engine_consent.sql
-- Lead Engine: dated, per-channel consent.
--
-- Two consent tables already exist and neither does this job. user_consents
-- holds legal waivers; marketing_consent_log holds one boolean keyed to a user.
-- Neither is per-channel, and neither can exist for a person without a users
-- row — which is exactly the population being imported.
--
-- Neither is migrated or dropped. This supersedes them going forward.

CREATE TABLE IF NOT EXISTS public.contact_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','sms')),
  granted       boolean NOT NULL,
  source        text NOT NULL,
  wording_shown text NOT NULL,
  ip_address    text,
  user_agent    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_consents_lookup_idx
  ON public.contact_consents (contact_id, channel, occurred_at DESC);

-- Keyed by identifier, not contact: a suppression must survive a merge, a
-- delete, and the same person arriving again months later.
CREATE TABLE IF NOT EXISTS public.contact_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES public.businesses(id) ON DELETE CASCADE,
  identifier   text NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_uniq
  ON public.contact_suppressions (business_id, identifier);

ALTER TABLE public.contact_consents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contact_consents"
  ON public.contact_consents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on contact_suppressions"
  ON public.contact_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);
