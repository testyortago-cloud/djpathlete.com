-- supabase/migrations/00257_pipeline_boards.sql
-- Lead Engine pipeline boards, phase 2: two more boards to route onto.
-- Spec: docs/superpowers/specs/2026-09-08-pipeline-boards-and-routing-design.md §2.2, §4
--
-- Seeds exactly the two boards `routeToPipeline` (lib/lead-engine/pipeline-route.ts,
-- Task 1) already names by key: CAMPS_CLINICS_KEY ("camps_clinics") and
-- ASSESSMENT_KEY ("assessment"). Deliberately does NOT seed a third
-- "Programs & Products" board -- spec §2.2 measured that of the 23 priced
-- programmes on production, 17 are private subscriptions named after the
-- individual athlete they were built for (coaching sales, already landing
-- correctly on Coaching) and exactly ONE row is public. A products board
-- would either become a client list with stages or hold a single card.
-- Seeding a board that is empty or wrong is worse than not seeding it, and
-- un-seeding one later needs a data migration; not seeding one now is free.
-- This is a controller ruling the owner may reverse -- do not quietly
-- reinstate the third board because the earlier 2026-09-01 design mentions
-- four.
--
-- SHAPE MIRRORS 00219's seed of "coaching" exactly: one `pipelines` row and a
-- handful of `pipeline_stages` rows per board, business_id hardcoded to the
-- singleton the same way 00219 did. (00249's create_business() function is
-- the per-tenant path for boards on businesses created AFTER this deploy --
-- it seeds only "coaching" today and is unchanged here. This phase's scope is
-- routing + seeding for the one business that exists now, not per-tenant
-- provisioning or the board editor -- see the plan's progress ledger. A
-- business created after this migration still gets only a Coaching board
-- until something teaches create_business() about these two as well; that is
-- a gap worth flagging, not one this migration's job to close.)
--
-- EVERY BOARD NEEDS AT LEAST ONE open, ONE won AND ONE lost STAGE, AND
-- EXACTLY ONE OF EACH won/lost (spec §4.1). `decideMove`
-- (lib/lead-engine/pipeline-move.ts) throws a bare Error at RUNTIME -- not
-- build time -- on a board missing an `open` stage (:112-113,
-- `if (!open.length) throw new Error("pipeline has no open stage")`) or
-- missing a `kind` it looks up with `.find()` (:118-119,
-- `const s = stages.find((x) => x.kind === kind); if (!s) throw ...`).
-- `.find()` does not throw on a SECOND `won` or `lost` stage -- it silently
-- returns whichever comes first in the array, which is an order-dependent
-- accident of where a paid card lands, not a loud failure. So each board
-- below carries exactly one `won` and exactly one `lost`.
--
-- STAGE NAMES ARE FOR A COACH, NOT A DEVELOPER (spec §6): no "opportunity",
-- no "board" -- the Pipeline page itself says "pipeline", "card" and
-- "stages".
--
-- Idempotent via `ON CONFLICT DO NOTHING` on both inserts, same as 00219;
-- proven by applying this file twice (see the task report).

-- ---------------------------------------------------------------------------
-- Camps & Clinics
-- ---------------------------------------------------------------------------

INSERT INTO public.pipelines (business_id, key, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'camps_clinics', 'Camps & Clinics')
ON CONFLICT (business_id, key) DO NOTHING;

INSERT INTO public.pipeline_stages (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
SELECT '00000000-0000-0000-0000-000000000001', p.id, s.key, s.name, s.position, s.kind, s.amber, s.red
  FROM public.pipelines p
 CROSS JOIN (VALUES
    ('interested', 'Interested', 1, 'open',  3,    7),
    ('registered', 'Registered', 2, 'open',  5,   14),
    ('won',        'Won',        3, 'won',  NULL, NULL),
    ('lost',       'Lost',       4, 'lost', NULL, NULL)
 ) AS s(key, name, position, kind, amber, red)
 WHERE p.key = 'camps_clinics'
   AND p.business_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (pipeline_id, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Assessment
-- ---------------------------------------------------------------------------

INSERT INTO public.pipelines (business_id, key, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'assessment', 'Assessment')
ON CONFLICT (business_id, key) DO NOTHING;

INSERT INTO public.pipeline_stages (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
SELECT '00000000-0000-0000-0000-000000000001', p.id, s.key, s.name, s.position, s.kind, s.amber, s.red
  FROM public.pipelines p
 CROSS JOIN (VALUES
    ('assessment_booked',    'Assessment Booked',    1, 'open',  3,    7),
    ('assessment_completed', 'Assessment Completed', 2, 'open',  5,   14),
    ('won',                  'Won',                  3, 'won',  NULL, NULL),
    ('lost',                 'Lost',                 4, 'lost', NULL, NULL)
 ) AS s(key, name, position, kind, amber, red)
 WHERE p.key = 'assessment'
   AND p.business_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (pipeline_id, key) DO NOTHING;
