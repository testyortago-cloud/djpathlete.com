-- Funnel builder: free-form landing-page / funnel builder that replaces
-- GoHighLevel as the page builder.
--
-- Four new tables, no changes to anything existing.
--
--   funnels               a campaign funnel (one or more pages)
--   funnel_steps          the pages within it; holds the GrapesJS DRAFT
--   funnel_step_versions  immutable published snapshots (compiled node tree)
--   funnel_submissions    form captures from published pages
--
-- Draft and published are separate on purpose: editing a live page never
-- changes what visitors see until Publish. Versions are immutable, so a
-- rollback is just pointing published_version_id at an older row.
--
-- Design doc: docs/superpowers/specs/2026-08-09-funnel-builder-design.md

-- ---------------------------------------------------------------------------
-- 1. funnels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'archived')),
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS funnels_slug_key ON public.funnels (lower(slug));
CREATE INDEX IF NOT EXISTS funnels_status_idx ON public.funnels (status);

COMMENT ON TABLE public.funnels IS
  'A campaign funnel. Public pages live at /go/<slug>[/<step slug>].';
COMMENT ON COLUMN public.funnels.status IS
  'Only status=published is reachable by the public route; draft/archived 404 unless previewed.';

-- ---------------------------------------------------------------------------
-- 2. funnel_steps — the pages, and the editable draft
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id            uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  slug                 text NOT NULL,
  name                 text NOT NULL,
  position             integer NOT NULL DEFAULT 0,
  is_entry             boolean NOT NULL DEFAULT false,
  seo_title            text,
  seo_description      text,
  og_image_url         text,
  noindex              boolean NOT NULL DEFAULT false,
  project_data         jsonb,
  published_version_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funnel_id, slug)
);

CREATE INDEX IF NOT EXISTS funnel_steps_funnel_idx ON public.funnel_steps (funnel_id, position);

-- Exactly one entry step per funnel.
CREATE UNIQUE INDEX IF NOT EXISTS funnel_steps_one_entry_idx
  ON public.funnel_steps (funnel_id) WHERE is_entry;

COMMENT ON COLUMN public.funnel_steps.project_data IS
  'GrapesJS editor state. This is the DRAFT — the public route never reads it.';
COMMENT ON COLUMN public.funnel_steps.published_version_id IS
  'Which funnel_step_versions row the public route renders. NULL = never published.';

-- ---------------------------------------------------------------------------
-- 3. funnel_step_versions — immutable published snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_step_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id      uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  nodes        jsonb NOT NULL,
  css          text NOT NULL DEFAULT '',
  project_data jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (step_id, version)
);

CREATE INDEX IF NOT EXISTS funnel_step_versions_step_idx
  ON public.funnel_step_versions (step_id, version DESC);

COMMENT ON COLUMN public.funnel_step_versions.nodes IS
  'Compiled FunnelNode tree (sanitised at publish time). Rendered as real React elements — '
  'never via dangerouslySetInnerHTML. See lib/funnels/compile/.';
COMMENT ON COLUMN public.funnel_step_versions.css IS
  'Stylesheet with every selector scoped under #djp-funnel-root.';

ALTER TABLE public.funnel_steps
  DROP CONSTRAINT IF EXISTS funnel_steps_published_version_fk;
ALTER TABLE public.funnel_steps
  ADD CONSTRAINT funnel_steps_published_version_fk
  FOREIGN KEY (published_version_id)
  REFERENCES public.funnel_step_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. funnel_submissions — captures from the form island
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.funnel_submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id              uuid NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  step_id                uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  form_key               text NOT NULL,
  email                  text,
  name                   text,
  phone                  text,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution_session_id text,
  ip_address             text,
  user_agent             text,
  lead_user_id           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_submissions_funnel_idx
  ON public.funnel_submissions (funnel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS funnel_submissions_email_idx
  ON public.funnel_submissions (lower(email));
CREATE INDEX IF NOT EXISTS funnel_submissions_session_idx
  ON public.funnel_submissions (attribution_session_id);

COMMENT ON COLUMN public.funnel_submissions.attribution_session_id IS
  'Joins to marketing_attribution so funnel leads share first-touch reporting with the rest of the site.';
