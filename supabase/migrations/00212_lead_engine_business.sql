-- supabase/migrations/00212_lead_engine_business.sql
-- Lead Engine: the tenant row every other Lead Engine table hangs off.
--
-- There is exactly one business today. The column exists anyway, because
-- separating one business's data from another's is cheap while the tables are
-- empty and expensive once they are not.

CREATE TABLE IF NOT EXISTS public.businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.businesses (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Primary')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.business_settings (
  business_id        uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  display_name       text    NOT NULL DEFAULT '',
  sender_name        text    NOT NULL DEFAULT '',
  sender_email       text    NOT NULL DEFAULT '',
  reply_to           text    NOT NULL DEFAULT '',
  logo_url           text,
  timezone           text    NOT NULL DEFAULT 'America/New_York',
  quiet_hours_start  smallint NOT NULL DEFAULT 8  CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end    smallint NOT NULL DEFAULT 21 CHECK (quiet_hours_end   BETWEEN 0 AND 23),
  daily_message_cap  smallint NOT NULL DEFAULT 1  CHECK (daily_message_cap >= 1),
  postal_address     text    NOT NULL DEFAULT '',
  sms_help_text      text    NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.business_settings (business_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (business_id) DO NOTHING;

ALTER TABLE public.businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on businesses"
  ON public.businesses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on business_settings"
  ON public.business_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
