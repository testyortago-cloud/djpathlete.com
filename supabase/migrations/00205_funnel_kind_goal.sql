-- Landing pages and funnels become separate things.
--
-- Every landing page was already a funnel: createFunnel inserts the funnels row
-- and an entry step in one breath. That collapse is why the create control
-- could only ask for a name — any richer question would have applied to just
-- one of the two things it might be making.
--
-- `kind` is STORED, NOT DERIVED FROM STEP COUNT. Deriving it would silently
-- relocate a page to the funnels screen the moment a second step was added,
-- and would turn every "is this a page?" question into a step-count query.
--
-- `goal` mirrors the CTA targets lib/funnels/sections/registry.ts already
-- resolves (program, session_pack, event, booking) plus `leads` for a form
-- capture, so the choice seeds a real call to action rather than a badge.
--
-- Design doc: docs/superpowers/specs/2026-08-12-landing-pages-vs-funnels-design.md

ALTER TABLE public.funnels
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page'
    CHECK (kind IN ('page', 'funnel')),
  ADD COLUMN IF NOT EXISTS goal text
    CHECK (goal IN ('leads', 'booking', 'program', 'session_pack', 'event'));

-- Backfill: anything already holding more than one step is a funnel. Runs
-- before any code reads the column, so no row is ever seen mis-typed.
UPDATE public.funnels f
   SET kind = 'funnel'
 WHERE (SELECT count(*) FROM public.funnel_steps s WHERE s.funnel_id = f.id) > 1;

CREATE INDEX IF NOT EXISTS funnels_kind_idx ON public.funnels (kind);

COMMENT ON COLUMN public.funnels.kind IS
  'page = one standalone landing page; funnel = an ordered multi-step sequence. '
  'Set explicitly at creation and changed only by the Convert to funnel action.';
COMMENT ON COLUMN public.funnels.goal IS
  'What the page is for. Nullable because rows backfilled from before this '
  'column have no honest value; new pages must choose one.';
