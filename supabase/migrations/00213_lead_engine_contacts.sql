-- supabase/migrations/00213_lead_engine_contacts.sql
-- Lead Engine: one row per human being.
--
-- `users` cannot do this job. users.email is unique and carries the login, so
-- two records for one person cannot both exist, and 90 of the contacts being
-- imported have a phone number and no email at all. So contacts sits beside
-- users: users owns login and billing, contacts owns marketing and consent.
--
-- No citext: the extension is not enabled here, so uniqueness is enforced with
-- expression indexes on lower(email), the pattern funnel_submissions uses.

CREATE TABLE IF NOT EXISTS public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  email         text,
  phone_e164    text,
  name          text,
  first_touch_session_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_need_one_identifier
    CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_email_uniq
  ON public.contacts (business_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_phone_uniq
  ON public.contacts (business_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_user_idx
  ON public.contacts (user_id) WHERE user_id IS NOT NULL;

-- Merges are destructive. Keep them reversible on paper.
CREATE TABLE IF NOT EXISTS public.contact_merges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  survivor_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  merged_id     uuid NOT NULL,
  merged_snapshot jsonb NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_merges_survivor_idx
  ON public.contact_merges (survivor_id, created_at DESC);

ALTER TABLE public.contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contacts"
  ON public.contacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on contact_merges"
  ON public.contact_merges FOR ALL TO service_role USING (true) WITH CHECK (true);
