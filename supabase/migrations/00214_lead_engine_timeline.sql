-- supabase/migrations/00214_lead_engine_timeline.sql
-- Lead Engine: append-only history for a contact.
--
-- Reads across both identity spines — contact-native events here, plus the
-- payments and bookings that still hang off users.

CREATE TABLE IF NOT EXISTS public.contact_timeline_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  source       text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_timeline_contact_idx
  ON public.contact_timeline_events (contact_id, occurred_at DESC);

ALTER TABLE public.contact_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contact_timeline_events"
  ON public.contact_timeline_events FOR ALL TO service_role USING (true) WITH CHECK (true);
