-- supabase/migrations/00219_lead_engine_pipeline.sql
-- Lead Engine Stage 1c: the pipeline board.
-- Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §3

CREATE TABLE IF NOT EXISTS public.pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                REFERENCES public.businesses(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipelines_key_per_business UNIQUE (business_id, key)
);

CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                REFERENCES public.businesses(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  position    int  NOT NULL,
  -- The state machine keys on `kind`, NEVER on `name`, so renaming a column
  -- header in the UI cannot break card movement.
  kind        text NOT NULL CHECK (kind IN ('open','won','lost')),
  amber_after_days int,
  red_after_days   int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_stages_key_per_pipeline UNIQUE (pipeline_id, key),
  CONSTRAINT pipeline_stages_position_per_pipeline UNIQUE (pipeline_id, position),
  CONSTRAINT pipeline_stages_thresholds_ordered
    CHECK (amber_after_days IS NULL OR red_after_days IS NULL
           OR amber_after_days <= red_after_days)
);

CREATE TABLE IF NOT EXISTS public.opportunities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  pipeline_id   uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  stage_id      uuid NOT NULL REFERENCES public.pipeline_stages(id),
  entered_stage_at timestamptz NOT NULL DEFAULT now(),
  value_cents   integer,
  currency      text NOT NULL DEFAULT 'usd',
  -- Copied from contacts.first_touch_session_id at creation and never updated.
  -- First touch is a property of the deal when it began; re-reading it live would
  -- let a later merge rewrite history under an already-reported closed deal.
  source_session_id text,
  outcome       text CHECK (outcome IN ('won','lost')),
  outcome_reason text,
  closed_at     timestamptz,
  -- A close is FINAL exactly when closed_trigger = 'manual'. Deliberately not
  -- derived from closed_by_user_id: that column is ON DELETE SET NULL, so
  -- deleting a departing admin would silently rewrite their Lost decisions into
  -- system closes and un-pin those cards months later. Identity must not carry
  -- the semantics. See spec §2.4.
  closed_trigger text CHECK (closed_trigger IN ('manual','booking','payment','reconciler','merge')),
  closed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_closed_fields_agree
    CHECK ((outcome IS NULL) = (closed_at IS NULL)
       AND (outcome IS NULL) = (closed_trigger IS NULL))
);

-- One OPEN deal per contact per board. A contact who books again while their
-- deal is live updates that card instead of spawning a second one.
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_one_open_per_contact_pipeline
  ON public.opportunities (contact_id, pipeline_id) WHERE outcome IS NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON public.opportunities (stage_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_contact ON public.opportunities (contact_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_session
  ON public.opportunities (source_session_id) WHERE source_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_won
  ON public.opportunities (business_id, closed_at) WHERE outcome = 'won';

CREATE TABLE IF NOT EXISTS public.opportunity_stage_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                   REFERENCES public.businesses(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  from_stage_id  uuid REFERENCES public.pipeline_stages(id),
  to_stage_id    uuid REFERENCES public.pipeline_stages(id),
  trigger        text NOT NULL CHECK (trigger IN ('booking','payment','manual','reconciler')),
  actor_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Non-null when an event WANTED to move this card and was refused (spec §2.4).
  -- A refused move is recorded, never silently dropped.
  refused_reason text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_opp_stage_events_opp
  ON public.opportunity_stage_events (opportunity_id, occurred_at DESC);

-- Seed: machinery for N boards, exactly one seeded (parent spec §2.3).
INSERT INTO public.pipelines (business_id, key, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'coaching', 'Coaching')
ON CONFLICT (business_id, key) DO NOTHING;

INSERT INTO public.pipeline_stages (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
SELECT '00000000-0000-0000-0000-000000000001', p.id, s.key, s.name, s.position, s.kind, s.amber, s.red
  FROM public.pipelines p
 CROSS JOIN (VALUES
    ('consult_booked', 'Consult Booked', 1, 'open',  3,    7),
    ('consulted',      'Consulted',      2, 'open',  5,   14),
    ('won',            'Won',            3, 'won',  NULL, NULL),
    ('lost',           'Lost',           4, 'lost', NULL, NULL)
 ) AS s(key, name, position, kind, amber, red)
 WHERE p.key = 'coaching'
   AND p.business_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (pipeline_id, key) DO NOTHING;
