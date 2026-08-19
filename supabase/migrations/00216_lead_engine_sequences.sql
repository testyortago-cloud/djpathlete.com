-- supabase/migrations/00216_lead_engine_sequences.sql
-- Lead Engine Stage 1b: the sequence engine's tables.
--
-- Design: docs/superpowers/specs/2026-08-18-lead-engine-stage1b-sequence-engine-design.md
--
-- Read §3.2 before adding an index here. In particular there is deliberately
-- NO unique index enforcing one active run per contact overall: the spec puts
-- that guardrail at SEND time (lib/lead-engine/guardrails.ts), because a
-- second sequence must be allowed to enrol and queue behind the first. An
-- index would silently discard the signal that the contact did something new,
-- which is schedule-time enforcement wearing a disguise.

CREATE TABLE IF NOT EXISTS public.sequences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                   REFERENCES public.businesses(id) ON DELETE CASCADE,
  key            text NOT NULL,
  name           text NOT NULL,
  description    text,
  -- Null means manual enrolment only. Otherwise matches a ContactEventSource
  -- in lib/db/contacts.ts.
  trigger_source text,
  trigger_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','paused','archived')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sequences_business_key_uniq
  ON public.sequences (business_id, key);
CREATE INDEX IF NOT EXISTS sequences_trigger_idx
  ON public.sequences (business_id, trigger_source, status)
  WHERE trigger_source IS NOT NULL;

-- All eight kinds are valid from day one even though three do not execute
-- yet (sms → Stage 2, tag/stage → Stage 1c). The schema should not need a
-- migration to gain a step type whose target already exists.
CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                       REFERENCES public.businesses(id) ON DELETE CASCADE,
  sequence_id        uuid NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  position           int  NOT NULL,
  kind               text NOT NULL
                       CHECK (kind IN ('email','sms','wait','branch','tag','stage','alert','stop')),
  wait_minutes       int,
  subject            text,
  body               text,
  branch_condition   jsonb,
  on_true_position   int,
  on_false_position  int,
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sequence_steps_wait_needs_minutes
    CHECK (kind <> 'wait' OR wait_minutes IS NOT NULL),
  CONSTRAINT sequence_steps_email_needs_body
    CHECK (kind <> 'email' OR (subject IS NOT NULL AND body IS NOT NULL)),
  CONSTRAINT sequence_steps_branch_needs_condition
    CHECK (kind <> 'branch' OR branch_condition IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS sequence_steps_position_uniq
  ON public.sequence_steps (sequence_id, position);

CREATE TABLE IF NOT EXISTS public.sequence_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                     REFERENCES public.businesses(id) ON DELETE CASCADE,
  sequence_id      uuid NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  current_position int  NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','exited','failed')),
  next_run_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  claimed_by       text,
  attempts         int  NOT NULL DEFAULT 0,
  -- Three text columns for three different owners, deliberately kept
  -- separate rather than merged into one "note" field:
  --   exit_reason  — written once, by exitRun/exitRunsForContact, when
  --                  status becomes 'exited'. Terminal.
  --   defer_reason — written by deferRun every time a guardrail defers an
  --                  ACTIVE run (quiet_hours / daily_cap / sibling_run).
  --                  This is the engine's normal steady state — most runs
  --                  sit deferred overnight or behind the daily cap — and
  --                  cleared back to null by advanceRun on forward progress.
  --   last_error   — written ONLY by failRun, when status becomes 'failed'.
  --                  A dashboard or health check filtering "WHERE last_error
  --                  IS NOT NULL" must see genuine crashes only. Overloading
  --                  it with routine defer reasons would make every quiet
  --                  night look like a failure and train the reader to
  --                  ignore the one column meant to flag a real problem.
  exit_reason      text,
  defer_reason     text,
  last_error       text,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- A double form-submit must not enrol the same contact into the same
-- sequence twice. This is NOT the one-active-sequence guardrail; see the
-- header comment.
CREATE UNIQUE INDEX IF NOT EXISTS sequence_runs_one_active_per_sequence
  ON public.sequence_runs (business_id, sequence_id, contact_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sequence_runs_due_idx
  ON public.sequence_runs (business_id, status, next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sequence_runs_contact_idx
  ON public.sequence_runs (contact_id, status);

CREATE TABLE IF NOT EXISTS public.sequence_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                        REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_id              uuid NOT NULL REFERENCES public.sequence_runs(id) ON DELETE CASCADE,
  step_id             uuid NOT NULL REFERENCES public.sequence_steps(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('email','sms')),
  -- The address as of send time. A contact may change theirs later; what was
  -- actually contacted must stay answerable.
  to_identifier       text NOT NULL,
  subject             text,
  body_rendered       text,
  provider            text,
  provider_message_id text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','failed','skipped')),
  error               text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- THE idempotency key. One message per step per run, enforced by the
-- database rather than by a read-then-write in application code.
CREATE UNIQUE INDEX IF NOT EXISTS sequence_messages_idem
  ON public.sequence_messages (run_id, step_id);
CREATE INDEX IF NOT EXISTS sequence_messages_contact_sent_idx
  ON public.sequence_messages (contact_id, sent_at DESC)
  WHERE status = 'sent';

-- Quiet hours run in the contact's timezone. Nothing populates this in
-- Stage 1b, so every contact resolves to business_settings.timezone today —
-- see lib/lead-engine/guardrails.ts resolveTimezone().
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS timezone text;

-- Stage 1a debt: contact_consents had no secondary sort key, so
-- "the most recent record wins" was undefined for rows sharing an
-- occurred_at. This must land BEFORE any marketing_consent_log backfill,
-- which would insert many rows with one timestamp.
ALTER TABLE public.contact_consents
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
DROP INDEX IF EXISTS contact_consents_lookup_idx;
CREATE INDEX IF NOT EXISTS contact_consents_lookup_idx
  ON public.contact_consents (contact_id, channel, occurred_at DESC, created_at DESC);

-- Stage 1a debt: timeline metadata carries raw funnel payload PII and had no
-- retention. The cron scrubs metadata and stamps this, keeping the row.
ALTER TABLE public.contact_timeline_events
  ADD COLUMN IF NOT EXISTS scrubbed_at timestamptz;
CREATE INDEX IF NOT EXISTS contact_timeline_scrub_idx
  ON public.contact_timeline_events (occurred_at)
  WHERE scrubbed_at IS NULL;

ALTER TABLE public.sequences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sequences"
  ON public.sequences FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on sequence_steps"
  ON public.sequence_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on sequence_runs"
  ON public.sequence_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on sequence_messages"
  ON public.sequence_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
