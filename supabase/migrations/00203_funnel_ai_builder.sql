-- supabase/migrations/00203_funnel_ai_builder.sql
--
-- The GrapesJS drag canvas is replaced by a conversational builder over a
-- TYPED SECTION document (lib/funnels/sections/doc.ts). Each turn appends a row
-- here carrying the FULL document it produced, so "put it back how it was three
-- messages ago" is a pointer copy, not a regeneration. A SectionDoc is ~5 KB, so
-- full snapshots are cheaper than the html+css they replace (~20 KB).
--
-- Published versions still live in funnel_step_versions. A chat turn is NOT a
-- version: versions are what visitors were served, turns are what the owner tried.

CREATE TABLE IF NOT EXISTS public.funnel_step_turns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES public.funnel_steps(id) ON DELETE CASCADE,
  revision          integer NOT NULL,
  parent_revision   integer,
  role              text NOT NULL CHECK (role IN ('user','assistant')),
  source            text NOT NULL DEFAULT 'ai'
                      CHECK (source IN ('ai','inspector','revert')),
  status            text NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('complete','failed')),

  -- Prose only. The owner's message, or the assistant's reply + change receipt.
  message           text NOT NULL DEFAULT '',
  -- The ops the model emitted, kept for debugging "why did it do that".
  ops               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- FULL SectionDoc after applying ops. NULL on user turns and on failures.
  doc               jsonb,

  -- Compiler verdict for THIS revision, so the chat can say "this can't be
  -- published because ..." without recompiling on every render.
  compile_status    text CHECK (compile_status IN ('ok','warnings','failed')),
  compile_problems  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Islands whose ref could not be resolved. Non-empty = publish blocked.
  unresolved        jsonb NOT NULL DEFAULT '[]'::jsonb,

  model                 text,
  tokens_input          integer,
  tokens_output         integer,
  cache_read_tokens     integer,
  cache_creation_tokens integer,
  latency_ms            integer,
  error_message         text,
  -- TRUE when the assistant said it could not do what was asked. Drives the
  -- ceiling tripwire in Stage 4 — do not remove.
  blocked           boolean NOT NULL DEFAULT false,

  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, revision)
);

CREATE INDEX IF NOT EXISTS funnel_step_turns_step_idx
  ON public.funnel_step_turns (step_id, revision DESC);

COMMENT ON COLUMN public.funnel_step_turns.doc IS
  'Full SectionDoc after this turn — NOT a diff. Undo and re-prompt both read it.';
COMMENT ON COLUMN public.funnel_step_turns.blocked IS
  'Assistant declined the request as outside the section schema. Tripwire metric.';

ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS doc_revision integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.funnel_steps.doc_revision IS
  'Revision of the SectionDoc in project_data. Optimistic lock: a build request
   carrying a stale revision gets a 409 and the client re-syncs.';

COMMENT ON COLUMN public.funnel_steps.project_data IS
  'The DRAFT SectionDoc (lib/funnels/sections/doc.ts). The public route never
   reads it. Was GrapesJS editor state before 00203.';
COMMENT ON COLUMN public.funnel_step_versions.project_data IS
  'SectionDoc snapshot the published html/css was rendered from.';

-- ---------------------------------------------------------------------------
-- RLS. 00202 created all four funnel tables with row level security DISABLED,
-- and funnel_submissions holds lead names, emails and phone numbers. Every read
-- and write goes through lib/db/funnels.ts / lib/db/funnel-builder.ts on the
-- SERVICE ROLE client, which bypasses RLS — so enabling it with no policies
-- closes the hole and breaks nothing. Verified by grep before applying: the
-- only callers of `from("funnel...")` anywhere in lib/ app/ components/ are in
-- lib/db/funnels.ts, all on createServiceRoleClient().
--
-- Scoped to funnel tables ONLY. Do NOT bulk-ALTER the 12 other RLS-disabled
-- tables Supabase flags: they have no policies either and enabling RLS there
-- would break working features.
-- ---------------------------------------------------------------------------

ALTER TABLE public.funnels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_step_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_step_turns    ENABLE ROW LEVEL SECURITY;
