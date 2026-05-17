-- supabase/migrations/00154_marketing_products.sql
-- Catalog of always-on programs the ads agent can propose campaigns for.
-- Distinct from `events` (specific clinic/camp instances); both feed the
-- agent's promotable_inventory signal. Edit rows here when a program's
-- audience, pricing, or signature keywords change.

CREATE TABLE IF NOT EXISTS public.marketing_products (
  slug              text PRIMARY KEY,
  name              text NOT NULL,
  one_liner         text NOT NULL,
  target_audience   text NOT NULL,
  signature_phrases text[] NOT NULL DEFAULT '{}',
  pain_points       text[] NOT NULL DEFAULT '{}',
  landing_url       text NOT NULL,
  lead_form_url     text,
  price_cents       integer,
  regular_price_cents integer,
  geo_focus         text[] NOT NULL DEFAULT '{}',
  conversion_type   text NOT NULL CHECK (conversion_type IN ('purchase', 'lead', 'booking')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.marketing_products IS
  'Static program catalog feeding the ads agent. Specific clinic/camp instances live in `events` and are merged at signal-gather time.';
COMMENT ON COLUMN public.marketing_products.signature_phrases IS
  'Phrases used by the agent to (a) seed keyword themes for SEARCH campaigns and (b) cross-reference against GSC organic queries to spot paid gaps.';
COMMENT ON COLUMN public.marketing_products.pain_points IS
  'Customer pain points the program addresses. Surface in ad copy headline/description suggestions.';
COMMENT ON COLUMN public.marketing_products.geo_focus IS
  'ISO country codes for online products, OR free-form geo descriptors (e.g. "Tampa Bay, FL") for local services.';

-- Row-Level Security
ALTER TABLE public.marketing_products ENABLE ROW LEVEL SECURITY;

-- service_role has full access (the agent reads + admin UI writes via service-role client).
CREATE POLICY marketing_products_service_role_all
  ON public.marketing_products
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_marketing_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_products_set_updated_at
  BEFORE UPDATE ON public.marketing_products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_marketing_products_updated_at();

-- ─── Seed: Rotational Reboot ────────────────────────────────────────────────
-- Confirmed by user 2026-05-17. Comeback Code skipped (pre-launch).
INSERT INTO public.marketing_products (
  slug, name, one_liner, target_audience,
  signature_phrases, pain_points,
  landing_url, lead_form_url,
  price_cents, regular_price_cents,
  geo_focus, conversion_type, status, notes
) VALUES (
  'rotational_reboot',
  'Rotational Reboot',
  'A 6-week core-led rotational power program (24 sessions, 4/week) for racket, club, stick and throwing athletes. Beginner-to-moderate intensity. Built by Darren J Paul, PhD.',
  'Athletes in rotational sports (tennis, golf, baseball, softball, lacrosse, hockey, soccer, volleyball, throwing events, boxing, MMA, cricket, squash, padel) whose racket / club / stick speed has plateaued.',
  ARRAY[
    'rotational power',
    'rotational power program',
    'hip-shoulder separation',
    'anti-rotation',
    'rotational core',
    'rotational strength',
    'racket speed',
    'club speed',
    'rotational mechanics',
    'rotational athlete training'
  ],
  ARRAY[
    'stalled racket / club / stick speed',
    'strong in the gym but no transfer to rotation',
    'random YouTube workouts for rotational athletes',
    'off-season programming chaos',
    'no clear progression from re-pattern to power expression'
  ],
  '/programs/rotational-reboot',
  '/programs/rotational-reboot',
  7900,
  24900,
  ARRAY['AU', 'US', 'NZ', 'GB'],
  'purchase',
  'active',
  'Online program. $79 (regular $249). 24 sessions / 6 weeks / 4 per week. Core-led ~70%. Trains on full gym or basic home setup.'
)
ON CONFLICT (slug) DO NOTHING;
