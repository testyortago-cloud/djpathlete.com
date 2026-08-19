# Lead Engine Stage 1b — Sequence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engine that decides, every five minutes, which contacts are due to hear from the business and whether it is allowed to tell them — shipped flagged off.

**Architecture:** A Firebase `onSchedule` tick posts to a Next.js internal route, which claims due runs through a plpgsql `SKIP LOCKED` function, passes each to a **pure** decision function, and executes the returned action. Every guardrail (quiet hours, daily cap, one-active-sequence) is a pure function evaluated at send time and always defers rather than skips. Sequences and their copy are seed data, not code.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role client), plpgsql, Firebase Functions v2 `onSchedule`, Resend, Vitest, `libphonenumber-js`.

**Spec:** `docs/superpowers/specs/2026-08-18-lead-engine-stage1b-sequence-engine-design.md` — read it before Task 1. §10 (the cascade trap) and §11 (the double-send audit) are the two sections most likely to be skipped and most expensive to skip.

## Global Constraints

- **`business_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'` on every new table**, referencing `businesses(id) ON DELETE CASCADE`. Import the literal from `lib/lead-engine/constants.ts` (`SINGLETON_BUSINESS_ID`) in TypeScript; never retype it.
- **RLS enabled + service-role full-access policy on every new table.** Copy the exact policy wording from `supabase/migrations/00215_lead_engine_consent.sql`.
- **No brand literals in new code.** The strings `DJP Athlete`, `Darren`, and `darrenjpaul.com` must not appear anywhere under `lib/lead-engine/`, `lib/automation/sequence-tick.ts`, or the seed migration. Business identity comes from `business_settings` via `getBusinessSettings()` in `lib/db/businesses.ts`. Task 5 ships the test that enforces this.
- **Every write to `contacts.email` goes through `normaliseEmail`** (`lib/lead-engine/identity.ts`). The unique index is on `lower(email)`; lookups use plain `.eq("email", …)`. They agree only because writes are pre-lowercased.
- **Absence of consent is never consent, and a failed read is not absence.** `hasConsent` throws on read error. Never `catch` it into `false`.
- **Guardrails evaluate at send time and defer, never skip.**
- **Tests:** targeted runs only — `npx vitest run <path>`. Never the full suite. `npx tsc --noEmit` compared as a **total error count against the 258 baseline**; grepping for your own filenames hides new errors elsewhere.
- **A Supabase mock must actually filter.** Stage 1a shipped two mocks whose `.eq()` returned the query object unconditionally, so every assertion passed trivially. Copy the filtering mock in `__tests__/db/contact-consents.test.ts`, which tracks filters and narrows the row set.
- **"This test would fail if X" is a guess until X has been applied and the failure observed.** Run your mutations.
- Feature flag `cron_sequence_tick_enabled`, default **false**.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/00216_lead_engine_sequences.sql` | Five tables, three meaningful indexes, three added columns |
| `supabase/migrations/00217_lead_engine_sequence_functions.sql` | `claim_sequence_runs()`, `merge_contacts()` |
| `supabase/migrations/00218_lead_engine_seed_sequences.sql` | Four sequences as seed data |
| `lib/lead-engine/guardrails.ts` | Pure: quiet hours, daily cap, sibling-run precedence |
| `lib/automation/sequence-tick.ts` | Pure: `decideStep`, branch predicate evaluation |
| `lib/db/sequences.ts` | All sequence IO: claim, load, send-record, advance/defer/exit |
| `lib/lead-engine/email.ts` | Settings-driven render + Resend send |
| `lib/lead-engine/unsubscribe-token.ts` | HMAC sign/verify, `unsub.` prefixed |
| `lib/lead-engine/enroll.ts` | `enrollIfTriggered` |
| `lib/db/contact-timeline-retention.ts` + `functions/src/lib/contact-timeline-retention.ts` | Twin retention helpers |
| `app/api/admin/internal/sequence-tick/route.ts` | Cron entry point |
| `app/api/admin/internal/contact-timeline-retention/route.ts` | Retention cron entry point |
| `app/(marketing)/unsubscribe/[token]/page.tsx` | One-click unsubscribe |

**Modified:**

| Path | Change |
|---|---|
| `lib/db/contacts.ts` | `mergeContacts` becomes an `.rpc()` call; `recordContactEvent` calls `enrollIfTriggered` |
| `lib/db/contact-consents.ts` | `hasConsent` tiebreak ordering; `suppress` matches `23505` |
| `lib/cron-catalog.ts` | Two new catalog entries |
| `app/api/admin/automation/trigger/route.ts` | Two new `VERCEL_ROUTE_JOBS` entries |
| `functions/src/index.ts` | `sequenceTickCron`, `contactTimelineRetentionCron` |
| `lib/audit/actions.ts` | New slugs |
| `app/api/stripe/webhook/route.ts`, `app/api/webhooks/ghl-booking/route.ts` | Exit hooks |
| `lib/automation/automation-health-scanner.ts` | Expected-cron list |

---

## Task 1: Schema — the five tables and the two functions

**Files:**
- Create: `supabase/migrations/00216_lead_engine_sequences.sql`
- Create: `supabase/migrations/00217_lead_engine_sequence_functions.sql`

**Interfaces:**
- Consumes: `businesses(id)`, `contacts(id)`, `contact_consents`, `contact_timeline_events` from migrations `00212`–`00215`.
- Produces: tables `sequences`, `sequence_steps`, `sequence_runs`, `sequence_messages`; columns `contacts.timezone`, `contact_consents.created_at`, `contact_timeline_events.scrubbed_at`; functions `claim_sequence_runs(uuid, int, text)` returning `SETOF sequence_runs` and `merge_contacts(uuid, uuid, uuid, text)` returning `void`.

**Why there is no unit test in this task:** a DDL file cannot be meaningfully unit-tested without a database, and a test that greps the SQL for the words `SKIP LOCKED` proves only that the words are present. The claim function is verified for real in Task 13 against a live database; the tables are exercised by every DAL task in between. Do not add a string-matching test here.

- [ ] **Step 1: Write `00216_lead_engine_sequences.sql`**

```sql
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
  exit_reason      text,
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
```

- [ ] **Step 2: Write `00217_lead_engine_sequence_functions.sql`**

Note the `merge_contacts` body re-points **four** child tables. Two of them
(`sequence_runs`, `sequence_messages`) did not exist when the original merge was
written. See spec §10 — this is the exact bug Stage 1a shipped once already.

```sql
-- supabase/migrations/00217_lead_engine_sequence_functions.sql
-- Lead Engine Stage 1b: the two operations Supabase REST cannot express.

-- Atomic claim. An overlapping tick must not double-send, so due runs are
-- claimed with FOR UPDATE SKIP LOCKED rather than read-then-write.
--
-- The stale-claim arm (claimed_at older than 10 minutes) is what stops a tick
-- that died mid-batch from stranding its runs forever. `attempts` climbing
-- without current_position moving is the signature of a poison run.
CREATE OR REPLACE FUNCTION public.claim_sequence_runs(
  p_business_id uuid,
  p_limit       int,
  p_claim_token text
)
RETURNS SETOF public.sequence_runs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.sequence_runs r
     SET claimed_at = now(),
         claimed_by = p_claim_token,
         attempts   = r.attempts + 1,
         updated_at = now()
   WHERE r.id IN (
     SELECT s.id
       FROM public.sequence_runs s
      WHERE s.business_id = p_business_id
        AND s.status      = 'active'
        AND s.next_run_at <= now()
        AND (s.claimed_at IS NULL OR s.claimed_at < now() - interval '10 minutes')
      ORDER BY s.next_run_at
        FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING r.*;
END;
$$;

-- Atomic merge. Replaces three un-transacted REST round-trips.
--
-- ORDER IS LOAD-BEARING: every child is re-pointed BEFORE the loser is
-- deleted, because all four cascade. Stage 1a shipped a version that missed
-- contact_consents and silently destroyed consent evidence — in the subsystem
-- whose entire purpose is defensible consent. Stage 1b adds two more children.
-- Before editing this function, list every FK onto contacts(id) and check it
-- appears below.
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_survivor uuid,
  p_merged   uuid,
  p_business uuid,
  p_reason   text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_loser          public.contacts%ROWTYPE;
  v_survivor       public.contacts%ROWTYPE;
  v_existing_merge uuid;
BEGIN
  SELECT * INTO v_loser    FROM public.contacts
    WHERE id = p_merged   AND business_id = p_business;
  SELECT * INTO v_survivor FROM public.contacts
    WHERE id = p_survivor AND business_id = p_business;

  -- Nothing to merge. Idempotent: a retry after a completed merge is a no-op.
  IF v_loser.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.contact_timeline_events SET contact_id = p_survivor WHERE contact_id = p_merged;
  UPDATE public.contact_consents        SET contact_id = p_survivor WHERE contact_id = p_merged;
  UPDATE public.sequence_messages       SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- Runs are re-pointed last among the children and need conflict handling:
  -- sequence_runs_one_active_per_sequence would reject moving a loser's
  -- active run into a sequence the survivor is already active in. In that
  -- case the survivor's own run stands and the loser's is marked exited, so
  -- the merge cannot fail on a unique violation.
  UPDATE public.sequence_runs r
     SET status = 'exited', exit_reason = 'merged_into_survivor', updated_at = now()
   WHERE r.contact_id = p_merged
     AND r.status = 'active'
     AND EXISTS (
       SELECT 1 FROM public.sequence_runs s
        WHERE s.contact_id  = p_survivor
          AND s.sequence_id = r.sequence_id
          AND s.status      = 'active');
  UPDATE public.sequence_runs SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- "A user always has a contact" only holds if a merge never drops the link.
  IF v_survivor.user_id IS NULL AND v_loser.user_id IS NOT NULL THEN
    UPDATE public.contacts SET user_id = v_loser.user_id WHERE id = p_survivor;
  ELSIF v_survivor.user_id IS NOT NULL
    AND v_loser.user_id IS NOT NULL
    AND v_survivor.user_id <> v_loser.user_id THEN
    INSERT INTO public.contact_timeline_events (business_id, contact_id, kind, source, metadata)
    VALUES (p_business, p_survivor, 'user_id_conflict', 'system_merge',
            jsonb_build_object('survivor_user_id', v_survivor.user_id,
                               'loser_user_id',    v_loser.user_id,
                               'merged_contact_id', p_merged));
  END IF;

  SELECT id INTO v_existing_merge FROM public.contact_merges
    WHERE survivor_id = p_survivor AND merged_id = p_merged;
  IF v_existing_merge IS NULL THEN
    INSERT INTO public.contact_merges (business_id, survivor_id, merged_id, merged_snapshot, reason)
    VALUES (p_business, p_survivor, p_merged, to_jsonb(v_loser), p_reason);
  END IF;

  DELETE FROM public.contacts WHERE id = p_merged AND business_id = p_business;
END;
$$;
```

- [ ] **Step 3: Verify the SQL parses**

If Docker is available, run it against a throwaway Postgres — this catches
syntax errors that would otherwise surface only when the migration runs
against a real database:

```bash
docker run --rm -d --name pgcheck -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:16
sleep 6
for f in supabase/migrations/0021{2,3,4,5,6,7}*.sql; do
  echo "--- $f"
  docker exec -i pgcheck psql -U postgres -v ON_ERROR_STOP=1 < "$f" || echo "FAILED: $f"
done
docker rm -f pgcheck
```

Expected: every file applies without error. `00213` references `public.users`,
which does not exist in a bare database — if it fails only on that FK, create a
minimal stub (`CREATE TABLE public.users (id uuid PRIMARY KEY);`) first and
re-run. Record the actual outcome; if Docker is unavailable, say so plainly in
the task report rather than claiming the SQL was verified.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00216_lead_engine_sequences.sql supabase/migrations/00217_lead_engine_sequence_functions.sql
git commit -m "feat(lead-engine): the sequence engine gets its tables, and the merge gets a transaction"
```

---

## Task 2: Pure guardrails

**Files:**
- Create: `lib/lead-engine/guardrails.ts`
- Test: `__tests__/lib/lead-engine/guardrails.test.ts`

**Interfaces:**
- Consumes: nothing. This file imports no database client and must stay that way — it is the reason the guardrail tests need no mocks.
- Produces:

```ts
export type QuietHours = { startHour: number; endHour: number }
export function resolveTimezone(contactTz: string | null | undefined, businessTz: string): string
export function quietHoursDefer(nowUtc: Date, tz: string, quiet: QuietHours): Date | null
export function localDayBounds(nowUtc: Date, tz: string): { start: Date; end: Date }
export function dailyCapDefer(
  nowUtc: Date, tz: string, cap: number, sentAt: Array<string | Date>,
): Date | null
export function siblingRunDefer(
  thisRun: { id: string; enrolled_at: string },
  activeSiblings: Array<{ id: string; enrolled_at: string }>,
  nowUtc: Date,
): Date | null
```

**Semantics, precisely:**

- `quietHoursDefer` returns `null` when `nowUtc` falls **inside** the allowed window `[startHour, endHour)` in `tz`, otherwise the UTC instant the window next opens. `business_settings` defaults are `start=8`, `end=21` — i.e. sending is *allowed* 08:00–20:59 local and blocked overnight. A window where `startHour >= endHour` (e.g. 21→8) wraps midnight; handle it.
- `localDayBounds` returns the UTC instants bracketing the contact's local calendar day. Use `Intl.DateTimeFormat` with `timeZone` — no new dependency.
- `dailyCapDefer` returns `null` when fewer than `cap` entries of `sentAt` fall inside today's local bounds, else the next local midnight.
- `siblingRunDefer` returns `null` when `thisRun` has the earliest `enrolled_at` among itself plus `activeSiblings` (ties broken by `id` ascending, so the answer is stable), else `nowUtc + 5 minutes`.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  resolveTimezone, quietHoursDefer, localDayBounds, dailyCapDefer, siblingRunDefer,
} from "@/lib/lead-engine/guardrails"

const QUIET = { startHour: 8, endHour: 21 }

describe("resolveTimezone", () => {
  it("prefers the contact's timezone", () => {
    expect(resolveTimezone("Europe/London", "America/New_York")).toBe("Europe/London")
  })
  it("falls back to the business timezone when the contact has none", () => {
    expect(resolveTimezone(null, "America/New_York")).toBe("America/New_York")
    expect(resolveTimezone(undefined, "America/New_York")).toBe("America/New_York")
    expect(resolveTimezone("", "America/New_York")).toBe("America/New_York")
  })
})

describe("quietHoursDefer", () => {
  it("allows a send in the middle of the local window", () => {
    // 15:00 UTC = 10:00 America/New_York (EDT, UTC-5 in August is -4 → 11:00)
    expect(quietHoursDefer(new Date("2026-08-18T15:00:00Z"), "America/New_York", QUIET)).toBeNull()
  })

  it("blocks a send before the window opens and defers to the opening instant", () => {
    // 09:00 UTC = 05:00 America/New_York — before 08:00 local.
    const defer = quietHoursDefer(new Date("2026-08-18T09:00:00Z"), "America/New_York", QUIET)
    expect(defer).not.toBeNull()
    // 08:00 America/New_York on the same local day = 12:00 UTC.
    expect(defer!.toISOString()).toBe("2026-08-18T12:00:00.000Z")
  })

  it("blocks a send after the window closes and defers to tomorrow's opening", () => {
    // 02:00 UTC on the 19th = 22:00 on the 18th in New York — after 21:00.
    const defer = quietHoursDefer(new Date("2026-08-19T02:00:00Z"), "America/New_York", QUIET)
    expect(defer!.toISOString()).toBe("2026-08-19T12:00:00.000Z")
  })

  it("is timezone-sensitive: the same instant is allowed in one zone and blocked in another", () => {
    const instant = new Date("2026-08-18T05:00:00Z") // 06:00 London, 01:00 New York
    expect(quietHoursDefer(instant, "Europe/London", QUIET)).not.toBeNull()   // 06:00 < 08:00
    expect(quietHoursDefer(instant, "Asia/Tokyo", QUIET)).toBeNull()          // 14:00 — fine
  })

  it("handles a window that wraps midnight", () => {
    // Allowed 21:00 → 08:00. 23:00 local is inside it.
    const wrap = { startHour: 21, endHour: 8 }
    expect(quietHoursDefer(new Date("2026-08-19T03:00:00Z"), "America/New_York", wrap)).toBeNull()
  })
})

describe("dailyCapDefer", () => {
  const tz = "America/New_York"
  const now = new Date("2026-08-18T18:00:00Z") // 14:00 local

  it("allows the first message of the local day", () => {
    expect(dailyCapDefer(now, tz, 1, [])).toBeNull()
  })

  it("blocks once the cap is reached today and defers to next local midnight", () => {
    const defer = dailyCapDefer(now, tz, 1, ["2026-08-18T13:00:00Z"]) // 09:00 local, same day
    expect(defer).not.toBeNull()
    expect(defer!.toISOString()).toBe("2026-08-19T04:00:00.000Z") // 00:00 local on the 19th
  })

  it("counts the LOCAL day, not the UTC day", () => {
    // 2026-08-18T02:00Z is 22:00 on the 17th in New York — a different local
    // day, so it must not count against the 18th's cap.
    expect(dailyCapDefer(now, tz, 1, ["2026-08-18T02:00:00Z"])).toBeNull()
  })

  it("honours a cap above one", () => {
    const two = ["2026-08-18T13:00:00Z", "2026-08-18T14:00:00Z"]
    expect(dailyCapDefer(now, tz, 3, two)).toBeNull()
    expect(dailyCapDefer(now, tz, 2, two)).not.toBeNull()
  })
})

describe("siblingRunDefer", () => {
  const now = new Date("2026-08-18T18:00:00Z")
  const mine = { id: "b", enrolled_at: "2026-08-10T00:00:00Z" }

  it("allows the oldest active run to send", () => {
    expect(siblingRunDefer(mine, [{ id: "c", enrolled_at: "2026-08-12T00:00:00Z" }], now)).toBeNull()
  })

  it("defers when an older sibling is active", () => {
    const defer = siblingRunDefer(mine, [{ id: "a", enrolled_at: "2026-08-01T00:00:00Z" }], now)
    expect(defer!.toISOString()).toBe("2026-08-18T18:05:00.000Z")
  })

  it("breaks an enrolled_at tie by id so the winner is stable", () => {
    const tie = { id: "a", enrolled_at: "2026-08-10T00:00:00Z" }
    expect(siblingRunDefer(mine, [tie], now)).not.toBeNull()  // "a" < "b", so "a" wins
    expect(siblingRunDefer(tie, [mine], now)).toBeNull()
  })

  it("allows a run with no siblings", () => {
    expect(siblingRunDefer(mine, [], now)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/lead-engine/guardrails.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/lead-engine/guardrails"`.

- [ ] **Step 3: Implement `lib/lead-engine/guardrails.ts`**

Use `Intl.DateTimeFormat` with `timeZone` and `hourCycle: "h23"` to read the
local wall-clock hour and date parts for an instant, then reconstruct the UTC
instant for a target local time by computing the zone's offset at that moment.
A correct helper pair:

```ts
// Wall-clock parts of `instant` as seen in `tz`.
function partsIn(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const { type, value } of fmt.formatToParts(instant)) p[type] = value
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
  }
}

// The UTC instant at which `tz` reads the given wall-clock time.
// Two passes converge because the offset changes by at most an hour or two.
function utcForLocal(tz: string, y: number, mo: number, d: number, h: number, mi = 0): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess += Date.UTC(y, mo - 1, d, h, mi, 0) - asUtc
  }
  return new Date(guess)
}
```

Build the four exported functions on top of these. `quietHoursDefer` compares
`partsIn(nowUtc, tz).hour` against the window; when blocked before the window
opens it returns `utcForLocal(tz, todayParts…, startHour)`, and when blocked
after it closes it returns the same for **tomorrow's** local date.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/lead-engine/guardrails.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the mutations — actually apply each, observe the failure, revert**

Do not write "this test would fail if…". Apply the change, run the suite, record
the real result, then revert:

1. In `dailyCapDefer`, replace the local-day bounds with a UTC-day comparison.
   Expected: the "counts the LOCAL day" test fails.
2. In `siblingRunDefer`, drop the id tiebreak.
   Expected: one of the two tie assertions fails.
3. In `quietHoursDefer`, return `null` unconditionally.
   Expected: at least three tests fail.

Report the observed failure counts. A mutation that does **not** break a test
means the behaviour is unguarded — add the missing test before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/guardrails.ts __tests__/lib/lead-engine/guardrails.test.ts
git commit -m "feat(lead-engine): quiet hours belong to the recipient, not the server"
```

---

## Task 3: Pure step decision

**Files:**
- Create: `lib/automation/sequence-tick.ts`
- Test: `__tests__/lib/automation/sequence-tick.test.ts`

**Interfaces:**
- Consumes: `QuietHours`, `quietHoursDefer`, `dailyCapDefer`, `siblingRunDefer` from `lib/lead-engine/guardrails.ts` (Task 2).
- Produces:

```ts
export type StepKind = "email" | "sms" | "wait" | "branch" | "tag" | "stage" | "alert" | "stop"

export type BranchCondition =
  | { kind: "has_phone" }
  | { kind: "has_user" }
  | { kind: "has_consent"; channel: "email" | "sms" }
  | { kind: "source_is"; value: string }

export type SequenceStepRow = {
  id: string
  position: number
  kind: StepKind
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: BranchCondition | null
  on_true_position: number | null
  on_false_position: number | null
  config: Record<string, unknown>
}

export type SequenceRunRow = {
  id: string
  sequence_id: string
  contact_id: string
  current_position: number
  enrolled_at: string
}

export type DecisionContext = {
  now: Date
  timezone: string
  quiet: QuietHours
  dailyCap: number
  sentAtToday: Array<string | Date>
  activeSiblings: Array<{ id: string; enrolled_at: string }>
  contact: { email: string | null; phone_e164: string | null; user_id: string | null }
  hasEmailConsent: boolean
  hasSmsConsent: boolean
  isSuppressed: boolean
  enrolledSource: string | null
}

export type StepAction =
  | { kind: "send"; step: SequenceStepRow; channel: "email" | "sms" }
  | { kind: "alert"; step: SequenceStepRow }
  | { kind: "advance"; toPosition: number; deferUntil?: Date; note?: string }
  | { kind: "defer"; until: Date; reason: string }
  | { kind: "exit"; reason: string }
  | { kind: "complete" }
  | { kind: "fail"; error: string }

export function evaluateBranch(
  condition: BranchCondition, ctx: DecisionContext,
): { ok: true; value: boolean } | { ok: false; error: string }

export function decideStep(
  run: SequenceRunRow, steps: SequenceStepRow[], ctx: DecisionContext,
): StepAction
```

**Consent policy — decided here, and load-bearing.** Stage 1a deliberately
writes no consent row from the funnel form, because `wording_shown` is NOT NULL
and the form displays no consent wording. So `hasConsent` returns `false` for
every contact that exists today. Gating email on it would make the engine
permanently inert.

The rule is therefore the US regime, and it differs by channel:

- **Email is opt-out.** Blocked only by `isSuppressed`. This is what CAN-SPAM
  requires and what the unsubscribe link in Task 6 delivers.
- **SMS is opt-in.** Requires `hasSmsConsent === true`. TCPA does not accept
  opt-out, and §6 of the parent spec already rules that the 90 imported phone
  numbers arrive with no SMS consent. No Stage 1b sequence sends SMS, so this
  branch is unreachable until Stage 2 — but the rule belongs in the pure
  function now, with its test, rather than being invented under deadline later.

**Decision order** (deterministic, and asserted by tests): suppression → step
lookup → step kind → guardrails, and within guardrails: sibling run → daily cap
→ quiet hours.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { decideStep, evaluateBranch } from "@/lib/automation/sequence-tick"
import type { DecisionContext, SequenceStepRow, SequenceRunRow } from "@/lib/automation/sequence-tick"

const run: SequenceRunRow = {
  id: "run-1", sequence_id: "seq-1", contact_id: "c-1",
  current_position: 0, enrolled_at: "2026-08-10T00:00:00Z",
}

function step(over: Partial<SequenceStepRow> & { position: number; kind: SequenceStepRow["kind"] }): SequenceStepRow {
  return {
    id: `s-${over.position}`, wait_minutes: null, subject: null, body: null,
    branch_condition: null, on_true_position: null, on_false_position: null,
    config: {}, ...over,
  }
}

function ctx(over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date("2026-08-18T18:00:00Z"),          // 14:00 America/New_York
    timezone: "America/New_York",
    quiet: { startHour: 8, endHour: 21 },
    dailyCap: 1,
    sentAtToday: [],
    activeSiblings: [],
    contact: { email: "a@example.com", phone_e164: null, user_id: null },
    hasEmailConsent: false,
    hasSmsConsent: false,
    isSuppressed: false,
    enrolledSource: "funnel_form",
    ...over,
  }
}

const emailStep = step({ position: 0, kind: "email", subject: "Hi", body: "Body" })

describe("decideStep — exits and terminal states", () => {
  it("exits immediately when the contact is suppressed", () => {
    expect(decideStep(run, [emailStep], ctx({ isSuppressed: true })))
      .toEqual({ kind: "exit", reason: "suppressed" })
  })

  it("completes when the position is past the end of the step list", () => {
    expect(decideStep({ ...run, current_position: 5 }, [emailStep], ctx()))
      .toEqual({ kind: "complete" })
  })

  it("completes on a stop step", () => {
    expect(decideStep(run, [step({ position: 0, kind: "stop" })], ctx()))
      .toEqual({ kind: "complete" })
  })
})

describe("decideStep — email and the consent regime", () => {
  it("sends email with no consent record, because email is opt-out", () => {
    const action = decideStep(run, [emailStep], ctx({ hasEmailConsent: false }))
    expect(action).toEqual({ kind: "send", step: emailStep, channel: "email" })
  })

  it("advances past an email step when the contact has no email address", () => {
    const action = decideStep(run, [emailStep], ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null } }))
    expect(action).toMatchObject({ kind: "advance", toPosition: 1, note: "no_email_address" })
  })

  it("refuses SMS without explicit consent, because SMS is opt-in", () => {
    const sms = step({ position: 0, kind: "sms", body: "hi" })
    const action = decideStep(run, [sms], ctx({
      contact: { email: null, phone_e164: "+15551234567", user_id: null },
      hasSmsConsent: false,
    }))
    expect(action).toMatchObject({ kind: "advance", note: "no_sms_consent" })
  })
})

describe("decideStep — wait", () => {
  it("advances past the wait and defers by its minutes", () => {
    const wait = step({ position: 0, kind: "wait", wait_minutes: 2880 })
    const action = decideStep(run, [wait, emailStep], ctx())
    expect(action).toMatchObject({ kind: "advance", toPosition: 1 })
    expect((action as any).deferUntil.toISOString()).toBe("2026-08-20T18:00:00.000Z")
  })
})

describe("decideStep — unsupported kinds are visible, not silent", () => {
  it.each(["tag", "stage"] as const)("advances past a %s step with a note", (kind) => {
    const action = decideStep(run, [step({ position: 0, kind })], ctx())
    expect(action).toMatchObject({ kind: "advance", toPosition: 1, note: "unsupported_kind" })
  })
})

describe("evaluateBranch", () => {
  it("resolves has_phone from the contact", () => {
    expect(evaluateBranch({ kind: "has_phone" }, ctx())).toEqual({ ok: true, value: false })
    expect(evaluateBranch({ kind: "has_phone" },
      ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null } })))
      .toEqual({ ok: true, value: true })
  })

  it("resolves has_user, has_consent and source_is", () => {
    expect(evaluateBranch({ kind: "has_user" },
      ctx({ contact: { email: "a@b.co", phone_e164: null, user_id: "u1" } })))
      .toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "has_consent", channel: "sms" }, ctx({ hasSmsConsent: true })))
      .toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "source_is", value: "funnel_form" }, ctx()))
      .toEqual({ ok: true, value: true })
    expect(evaluateBranch({ kind: "source_is", value: "newsletter" }, ctx()))
      .toEqual({ ok: true, value: false })
  })

  it("REFUSES an unknown predicate instead of defaulting to false", () => {
    const result = evaluateBranch({ kind: "phase_of_moon" } as any, ctx())
    expect(result.ok).toBe(false)
  })
})

describe("decideStep — branch routing", () => {
  const branch = step({
    position: 0, kind: "branch",
    branch_condition: { kind: "has_phone" },
    on_true_position: 5, on_false_position: 9,
  })

  it("routes to on_false_position when the predicate is false", () => {
    expect(decideStep(run, [branch], ctx())).toMatchObject({ kind: "advance", toPosition: 9 })
  })

  it("routes to on_true_position when the predicate is true", () => {
    const action = decideStep(run, [branch],
      ctx({ contact: { email: null, phone_e164: "+15551234567", user_id: null } }))
    expect(action).toMatchObject({ kind: "advance", toPosition: 5 })
  })

  it("falls through to the next position when the target is null", () => {
    const open = step({ position: 0, kind: "branch", branch_condition: { kind: "has_phone" }, on_true_position: null, on_false_position: null })
    expect(decideStep(run, [open], ctx())).toMatchObject({ kind: "advance", toPosition: 1 })
  })

  it("FAILS the run on an unknown predicate rather than guessing an arm", () => {
    const bad = step({ position: 0, kind: "branch", branch_condition: { kind: "nope" } as any, on_true_position: 5, on_false_position: 9 })
    expect(decideStep(run, [bad], ctx())).toMatchObject({ kind: "fail" })
  })
})

describe("decideStep — guardrails, in order", () => {
  it("defers when an older sibling run is active", () => {
    const action = decideStep(run, [emailStep], ctx({
      activeSiblings: [{ id: "run-0", enrolled_at: "2026-08-01T00:00:00Z" }],
    }))
    expect(action).toMatchObject({ kind: "defer", reason: "sibling_run" })
  })

  it("defers when the daily cap is already met", () => {
    const action = decideStep(run, [emailStep], ctx({ sentAtToday: ["2026-08-18T13:00:00Z"] }))
    expect(action).toMatchObject({ kind: "defer", reason: "daily_cap" })
  })

  it("defers outside quiet hours", () => {
    const action = decideStep(run, [emailStep], ctx({ now: new Date("2026-08-18T09:00:00Z") }))
    expect(action).toMatchObject({ kind: "defer", reason: "quiet_hours" })
  })

  it("checks the sibling run BEFORE the daily cap", () => {
    const action = decideStep(run, [emailStep], ctx({
      activeSiblings: [{ id: "run-0", enrolled_at: "2026-08-01T00:00:00Z" }],
      sentAtToday: ["2026-08-18T13:00:00Z"],
    }))
    expect(action).toMatchObject({ kind: "defer", reason: "sibling_run" })
  })

  it("does NOT apply send guardrails to a wait step", () => {
    const wait = step({ position: 0, kind: "wait", wait_minutes: 60 })
    const action = decideStep(run, [wait, emailStep], ctx({ now: new Date("2026-08-18T09:00:00Z") }))
    expect(action).toMatchObject({ kind: "advance" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/automation/sequence-tick.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/automation/sequence-tick.ts`**

Pure module. It must not import `@/lib/supabase` or any DAL — if it does, the
mock-free tests above become impossible and the file has drifted from its
purpose. Structure `decideStep` as: suppression check → `steps.find(s =>
s.position === run.current_position)` (undefined → `complete`) → `switch
(step.kind)` → for sendable kinds only, run the three guardrails in the stated
order and return the first non-null defer.

`evaluateBranch` returns `{ ok: false, error }` for any `kind` outside the four
in `BranchCondition`; `decideStep` turns that into `{ kind: "fail" }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/automation/sequence-tick.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the mutations**

Apply each, observe, revert. Report observed results:

1. Make `evaluateBranch` return `{ ok: true, value: false }` for unknown kinds.
   Expected: the "REFUSES an unknown predicate" and "FAILS the run" tests fail.
2. Swap the guardrail order so the daily cap is checked before the sibling run.
   Expected: the "checks the sibling run BEFORE the daily cap" test fails.
3. Gate the email branch on `hasEmailConsent`.
   Expected: "sends email with no consent record" fails.

- [ ] **Step 6: Commit**

```bash
git add lib/automation/sequence-tick.ts __tests__/lib/automation/sequence-tick.test.ts
git commit -m "feat(lead-engine): the engine decides what to do next without touching the database"
```

---

## Task 4: The sequences DAL

**Files:**
- Create: `lib/db/sequences.ts`
- Test: `__tests__/db/sequences.test.ts`

**Interfaces:**
- Consumes: `SequenceRunRow`, `SequenceStepRow` from Task 3; `SINGLETON_BUSINESS_ID` from `lib/lead-engine/constants.ts`; `createServiceRoleClient` from `@/lib/supabase`.
- Produces:

```ts
export async function claimDueRuns(limit: number, claimToken: string, businessId?: string): Promise<SequenceRunRow[]>
export async function loadSteps(sequenceId: string): Promise<SequenceStepRow[]>
export async function loadRunContext(run: SequenceRunRow, businessId?: string): Promise<DecisionContext>
export async function recordSend(args: {
  runId: string; stepId: string; contactId: string
  channel: "email" | "sms"; toIdentifier: string
  subject: string | null; bodyRendered: string
  businessId?: string
}): Promise<{ claimed: boolean; messageId: string | null }>
export async function markSent(messageId: string, provider: string, providerMessageId: string | null): Promise<void>
export async function markFailed(messageId: string, error: string): Promise<void>
export async function advanceRun(runId: string, toPosition: number, deferUntil?: Date): Promise<void>
export async function deferRun(runId: string, until: Date, reason: string): Promise<void>
export async function exitRun(runId: string, reason: string): Promise<void>
export async function completeRun(runId: string): Promise<void>
export async function failRun(runId: string, error: string): Promise<void>
export async function exitRunsForContact(contactId: string, reason: string): Promise<number>
```

**`recordSend` is the idempotency gate and the subtlest function here.** It
inserts a `sequence_messages` row with `status='queued'` **before** the provider
is called:

- Insert succeeds → `{ claimed: true, messageId }`. Caller sends.
- Insert fails with `23505` → a row already exists for `(run_id, step_id)`. Read
  it. If `status='queued'` **and** `provider_message_id IS NULL` **and**
  `created_at` is older than 15 minutes, this is a crashed prior attempt:
  return `{ claimed: true, messageId: <existing id> }` so it is retried.
  Otherwise return `{ claimed: false, messageId: null }` and the caller skips.
- Any other error → throw.

This is **at-least-once, not exactly-once**. Say so in the doc comment. The
alternative — never retrying — stalls a sequence forever on a single crash.

- [ ] **Step 1: Write the failing tests**

Copy the filtering mock from `__tests__/db/contact-consents.test.ts` — the one
that tracks applied filters and actually narrows rows. Do not write a mock whose
`.eq()` returns the query object without recording the filter; Stage 1a shipped
two of those and they made every assertion pass trivially.

Required cases, minimum:

```ts
describe("recordSend — the idempotency gate", () => {
  it("claims the send when no message row exists yet", async () => { /* expect claimed: true */ })

  it("refuses a second claim for the same (run_id, step_id)", async () => {
    // First call claims. Second call must return { claimed: false } — this is
    // the overlapping-tick double-send guard.
  })

  it("re-claims a queued row older than 15 minutes with no provider id", async () => {
    // Simulates a crash between insert and send.
  })

  it("does NOT re-claim a queued row younger than 15 minutes", async () => {})

  it("does NOT re-claim a row that already sent", async () => {
    // status='sent' with a provider_message_id must never be re-sent.
  })

  it("rethrows a non-23505 error instead of treating it as a duplicate", async () => {
    // A read failure is not "already sent".
  })
})

describe("exitRunsForContact", () => {
  it("exits only the ACTIVE runs of the given contact", async () => {
    // Seed: two active runs for c-1, one completed run for c-1, one active
    // run for c-2. Assert only the two active c-1 runs change, and that the
    // c-2 run is untouched — this is the assertion a non-filtering mock
    // would let pass while the code exited everyone.
  })
  it("returns the number of runs exited", async () => {})
})

describe("claimDueRuns", () => {
  it("calls the claim_sequence_runs RPC rather than reading then writing", async () => {
    // Assert the rpc name and args. A read-then-write implementation cannot
    // be safe under overlapping ticks; Task 13 proves the SQL itself.
  })
  it("throws on RPC error rather than returning an empty batch", async () => {
    // An empty batch and a failed read are different answers.
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/db/sequences.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/db/sequences.ts`**

`claimDueRuns` calls `supabase.rpc("claim_sequence_runs", { p_business_id, p_limit, p_claim_token })`.
`exitRunsForContact` updates `sequence_runs` filtered by `.eq("contact_id", …).eq("status", "active")`.
`loadRunContext` assembles the `DecisionContext` from `business_settings`, the
contact row, `contact_consents` (via `hasConsent`), `contact_suppressions` (via
`isSuppressed`), today's `sequence_messages`, and sibling active runs.

`loadRunContext` must **not** swallow a `hasConsent` throw. A failed consent read
is not "no consent"; let it propagate so the run fails visibly rather than
sending or exiting on a guess.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/db/sequences.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the mock actually filters**

Before trusting green, break the implementation on purpose: change
`exitRunsForContact` to drop its `.eq("contact_id", …)` filter. The
"exits only the ACTIVE runs of the given contact" test **must** fail. If it
still passes, the mock is inert — fix the mock, not the test. Revert after.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sequences.ts __tests__/db/sequences.test.ts
git commit -m "feat(lead-engine): a send is claimed once, by one tick, or not at all"
```

---

## Task 5: The settings-driven sender

**Files:**
- Create: `lib/lead-engine/email.ts`
- Test: `__tests__/lib/lead-engine/email.test.ts`
- Test: `__tests__/lib/lead-engine/no-brand-literals.test.ts`

**Interfaces:**
- Consumes: `getBusinessSettings()` from `lib/db/businesses.ts` (returns `display_name`, `sender_name`, `sender_email`, `reply_to`, `logo_url`, `postal_address`, `timezone`, `quiet_hours_start`, `quiet_hours_end`, `daily_message_cap`).
- Produces:

```ts
export function renderSequenceEmail(args: {
  settings: BusinessSettings
  subject: string
  body: string
  unsubscribeUrl: string
  contactName: string | null
}): { subject: string; html: string; text: string }

export async function sendSequenceEmail(args: {
  to: string
  subject: string
  body: string
  unsubscribeUrl: string
  contactName: string | null
  settings?: BusinessSettings
}): Promise<{ providerMessageId: string | null }>
```

`renderSequenceEmail` is pure and takes settings as a parameter — that is what
makes it testable without a database and what keeps every brand string out of
the file.

Requirements:
- `from` is `` `${settings.sender_name} <${settings.sender_email}>` ``.
- `replyTo` is `settings.reply_to`.
- The footer contains `settings.postal_address` and the unsubscribe link — both
  are CAN-SPAM requirements, and a missing postal address is a violation, so
  render it unconditionally.
- Set the `List-Unsubscribe` header to `<unsubscribeUrl>` and
  `List-Unsubscribe-Post` to `List-Unsubscribe=One-Click`.
- Support `{{name}}` substitution in subject and body from `contactName`,
  falling back to an empty string — never to a brand word or a guessed name.
- Guard on a missing `RESEND_API_KEY` exactly as `lib/email.ts` does, so tests
  and a drifted env never reach the live API.

- [ ] **Step 1: Write the failing tests**

```ts
describe("renderSequenceEmail", () => {
  it("takes every piece of identity from settings, not from constants", () => {
    // Render with two DIFFERENT settings objects and assert the output
    // differs in sender name, display name and postal address. A hardcoded
    // brand string cannot pass this.
  })
  it("always renders the postal address and the unsubscribe link", () => {})
  it("substitutes {{name}} and falls back to empty when the contact has none", () => {})
})

describe("sendSequenceEmail", () => {
  it("sets List-Unsubscribe and List-Unsubscribe-Post headers", () => {})
  it("skips the provider entirely when RESEND_API_KEY is unset", () => {})
})
```

- [ ] **Step 2: Write the brand-literal scan test**

This delivers spec §2.2's third promise. It must read files from disk so it
catches a literal added later by anyone.

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

const FORBIDDEN = [/DJP\s*Athlete/i, /\bDarren\b/i, /darrenjpaul\.com/i]

const ROOTS = [
  "lib/lead-engine",
  "lib/automation/sequence-tick.ts",
  "lib/db/sequences.ts",
  "supabase/migrations/00218_lead_engine_seed_sequences.sql",
]

function filesUnder(p: string): string[] {
  const st = statSync(p, { throwIfNoEntry: false })
  if (!st) return []
  if (st.isFile()) return [p]
  return readdirSync(p).flatMap((child) => filesUnder(join(p, child)))
}

describe("the Lead Engine carries no brand literal", () => {
  it("scans every Lead Engine source file", () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of filesUnder(root)) {
        const text = readFileSync(file, "utf8")
        for (const re of FORBIDDEN) {
          if (re.test(text)) offenders.push(`${file} matched ${re}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("is actually scanning files — a guard against a silently empty sweep", () => {
    // If ROOTS ever stops resolving, the test above passes vacuously. This
    // is the null-vs-empty distinction: "found nothing" and "looked at
    // nothing" must not be the same result.
    expect(filesUnder("lib/lead-engine").length).toBeGreaterThan(3)
  })
})
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `npx vitest run __tests__/lib/lead-engine/email.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts`
Expected: FAIL — module not found; the scan's second test fails on the file count.

- [ ] **Step 4: Implement `lib/lead-engine/email.ts`**

- [ ] **Step 5: Run both suites to verify they pass**

Note: the seed migration in `ROOTS` does not exist until Task 12. `filesUnder`
returns `[]` for a missing path, which is correct — but confirm Task 12 re-runs
this suite once the file exists.

- [ ] **Step 6: Mutation — prove the scan bites**

Add the literal `DJP Athlete` to a comment in `lib/lead-engine/email.ts`, run
the scan, confirm it fails, remove it. Report the observed failure.

- [ ] **Step 7: Commit**

```bash
git add lib/lead-engine/email.ts __tests__/lib/lead-engine/email.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts
git commit -m "feat(lead-engine): the business's name comes from its settings, and a test keeps it that way"
```

---

## Task 6: The unsubscribe token and route

**Files:**
- Create: `lib/lead-engine/unsubscribe-token.ts`
- Create: `app/(marketing)/unsubscribe/[token]/page.tsx`
- Test: `__tests__/lib/lead-engine/unsubscribe-token.test.ts`
- Test: `__tests__/app/unsubscribe-token-route.test.ts`

**Interfaces:**
- Consumes: `exitRunsForContact` (Task 4), `recordConsent`/`suppress` from `lib/db/contact-consents.ts`.
- Produces:

```ts
export function signUnsubscribeToken(contactId: string, businessId: string): string
export type UnsubVerify = { valid: true; contactId: string; businessId: string } | { valid: false }
export function verifyUnsubscribeToken(token: string): UnsubVerify
export function unsubscribeUrl(baseUrl: string, contactId: string, businessId: string): string
```

**The prefix is a security requirement, not decoration.** Follow
`lib/qr/checkin-token.ts`: HMAC-SHA256 over `NEXTAUTH_SECRET`, base64url,
`timingSafeEqual`. The payload **must** be prefixed `unsub.` and verification
**must** reject any token whose first segment is not `unsub.`.

That file already documents a bug where token families sharing the secret
cross-validated because a non-date segment yielded `NaN`. The families that
exist today are `pc.` (personal check-in), `ap.` (athlete profile) and the
bare coach token. An unprefixed unsubscribe token is that bug again with a
worse blast radius: a check-in link that silently unsubscribes someone.

- [ ] **Step 1: Write the failing token tests**

```ts
describe("unsubscribe token", () => {
  it("round-trips a contact and business id", () => {})
  it("rejects a tampered signature", () => {})
  it("rejects a token whose payload was swapped for another contact", () => {})

  it("REJECTS a personal check-in token — token families must not cross-validate", () => {
    // This is the regression guard for the documented `pc.`/NaN bug.
    const foreign = signPersonalCheckinToken("some-user-id")   // from lib/qr/checkin-token
    expect(verifyUnsubscribeToken(foreign)).toEqual({ valid: false })
  })

  it("is itself rejected by verifyPersonalCheckinToken — the guard runs both ways", () => {
    const ours = signUnsubscribeToken("c-1", "b-1")
    expect(verifyPersonalCheckinToken(ours)).toEqual({ valid: false })
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement, then verify pass**

Run: `npx vitest run __tests__/lib/lead-engine/unsubscribe-token.test.ts`

- [ ] **Step 3: Write the route tests, then the route**

The page is a server component at `app/(marketing)/unsubscribe/[token]/page.tsx`.
On render it verifies the token and, when valid, performs all four writes:

1. `recordConsent({ contactId, channel: "email", granted: false, source: "unsubscribe_link", wordingShown: <the exact footer sentence the email carried> })` — `wording_shown` is NOT NULL and must quote something real. Export that sentence as a constant from `lib/lead-engine/email.ts` and import it here so the two can never drift.
2. `suppress(<the contact's email>, "unsubscribed")`.
3. `exitRunsForContact(contactId, "unsubscribed")`.
4. A `contact_timeline_events` row of kind `unsubscribed`.

Required cases:

```ts
it("renders a confirmation and suppresses on a valid token", async () => {})
it("does not write anything for an invalid token", async () => {})
it("is idempotent — a second visit does not throw or double-suppress", async () => {})
it("exits active sequence runs", async () => {})
```

- [ ] **Step 4: Commit**

```bash
git add lib/lead-engine/unsubscribe-token.ts "app/(marketing)/unsubscribe/[token]/page.tsx" __tests__/lib/lead-engine/unsubscribe-token.test.ts __tests__/app/unsubscribe-token-route.test.ts
git commit -m "feat(lead-engine): one click out, and it reaches every sequence"
```

---

## Task 7: Enrolment

**Files:**
- Create: `lib/lead-engine/enroll.ts`
- Modify: `lib/db/contacts.ts` (call at the end of `recordContactEvent`)
- Test: `__tests__/lib/lead-engine/enroll.test.ts`

**Interfaces:**
- Produces: `export async function enrollIfTriggered(args: { contactId: string; source: ContactEventSource; metadata?: Record<string, unknown>; businessId?: string }): Promise<{ enrolled: string[] }>`

Behaviour:
- Select `sequences` where `business_id`, `status='active'`, `trigger_source = source`.
- For each, insert a `sequence_runs` row with `current_position = 0`, `next_run_at = now()`.
- A `23505` unique violation on `sequence_runs_one_active_per_sequence` is **not an error** — it means this contact is already in this sequence, which is the correct outcome of a double submit. Swallow it and continue to the next sequence.
- `trigger_filter` matching: if the filter object is non-empty, every key must equal the same key in `metadata`. An empty filter matches everything.

**Wiring into `recordContactEvent`** — non-fatal, exactly like the existing
timeline write. Place it after the timeline insert and before `return`:

```ts
try {
  await enrollIfTriggered({ contactId, source: input.source, metadata: input.metadata, businessId })
} catch (err) {
  // Enrolment is marketing; the contact record is the thing that matters.
  // Losing an enrolment is recoverable, losing the lead is not — the same
  // contract lib/funnels/capture-contact.ts documents.
  const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
  console.error(`recordContactEvent: enrolment failed for contact ${contactId} (source: ${input.source})`, {
    code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
    message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
  })
}
```

Note the logged fields: `code` and `message` only. Never log `details` or `hint`
— a unique-index violation on contacts embeds the literal email address in
`details`. This is the PII rule `lib/funnels/capture-contact.ts` already
documents.

Required cases:

```ts
it("enrols into every active sequence whose trigger matches the source", async () => {})
it("ignores draft, paused and archived sequences", async () => {})
it("ignores sequences whose trigger_source is null", async () => {})
it("treats a duplicate-run 23505 as already-enrolled, not an error", async () => {})
it("applies trigger_filter against the event metadata", async () => {})
it("never throws out of recordContactEvent when enrolment fails", async () => {})
```

- [ ] **Steps:** write failing tests → run (FAIL) → implement → run (PASS) → mutation: make the `23505` path rethrow and confirm the duplicate test fails → revert → commit.

```bash
git commit -m "feat(lead-engine): a form submission starts the conversation it should"
```

---

## Task 8: The tick route and its cron wiring

**Files:**
- Create: `app/api/admin/internal/sequence-tick/route.ts`
- Modify: `functions/src/index.ts` (add `sequenceTickCron`)
- Modify: `lib/cron-catalog.ts` (add the catalog entry)
- Modify: `app/api/admin/automation/trigger/route.ts` (add to `VERCEL_ROUTE_JOBS`)
- Modify: `lib/audit/actions.ts` (new slugs)
- Modify: `lib/automation/automation-health-scanner.ts` (expected-cron list)
- Test: `__tests__/api/admin/internal/sequence-tick.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `export async function runSequenceTick(opts?: { limit?: number; now?: Date }): Promise<TickSummary>` where `TickSummary = { claimed: number; sent: number; deferred: number; exited: number; completed: number; failed: number }`.

Copy `app/api/admin/internal/inbox-sla/route.ts` for the route shape: the
`INTERNAL_CRON_TOKEN` bearer check, `isCronSkipped({ enabledKey:
"cron_sequence_tick_enabled", defaultEnabled: false })`, `export const runtime =
"nodejs"`, and `export const maxDuration = 120`. Wrap the body in
`logCronStart`/`logCronEnd` from `lib/db/cron-runs.ts`.

The per-run loop must be **fault-isolated**: one run that throws marks that run
failed and continues the batch. A single poison run must not stop every other
contact's sequence.

Catalog entry for `lib/cron-catalog.ts` — add `"sequence-tick"` to `CronJobName`
and:

```ts
{
  name: "sequence-tick",
  label: "Follow-up sequences",
  description:
    "Every five minutes, checks which leads are due their next follow-up email and sends it — respecting quiet hours in their timezone, a daily limit of one message per person, and anyone who has unsubscribed.",
  schedule: "*/5 * * * *",
  timezone: "UTC",
  humanSchedule: "Every 5 minutes",
  firebaseFunction: "sequenceTickCron",
  phase: "lead-engine-1b",
  enabledKey: "cron_sequence_tick_enabled",
  defaultEnabled: false,
},
```

And in `VERCEL_ROUTE_JOBS`: `"sequence-tick": "/api/admin/internal/sequence-tick",`
— the runner is a Next.js route, not a Firebase function, so the "Run now"
button must dispatch to Vercel.

Firebase function in `functions/src/index.ts`, matching `inboxSlaCron`'s shape
with `schedule: "*/5 * * * *"` and `secrets: [internalCronToken, appUrl]`.

Required cases:

```ts
it("401s without the bearer token", async () => {})
it("skips when the flag is off, and does not claim anything", async () => {})
it("claims, decides and records a send for a due run", async () => {})
it("continues the batch when one run throws", async () => {})
it("writes a cron_runs row on both success and failure", async () => {})
```

- [ ] **Steps:** failing tests → run → implement route + wiring → run → **verify the catalog and the trigger map agree**: `CRON_CATALOG.find(c => c.name === "sequence-tick")` must exist and `VERCEL_ROUTE_JOBS["sequence-tick"]` must be set, or the "Run now" button 500s. Add an assertion for that pairing. → commit.

```bash
git commit -m "feat(lead-engine): the engine wakes every five minutes, and only when it is switched on"
```

---

## Task 9: Exit hooks on payment and booking

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Modify: `app/api/webhooks/ghl-booking/route.ts`
- Modify: `lib/db/contacts.ts` (add `findContactByIdentifiers`)
- Test: `__tests__/lib/db/find-contact-by-identifiers.test.ts`
- Test: `__tests__/api/webhooks/sequence-exit-hooks.test.ts`

**Interfaces:**
- Produces: `export async function findContactByIdentifiers(args: { email?: string | null; phone?: string | null; userId?: string | null; businessId?: string }): Promise<string | null>`

Resolution order: `userId` → `email` (normalised) → `phone` (normalised).
Returns `null` when nothing matches — that is a legitimate answer, not an error.

Both hooks are one non-fatal call each:

```ts
// A marketing exit must never fail a payment webhook. Stripe retries on a
// non-2xx, so a throw here would replay a payment side effect to fix a
// follow-up email.
try {
  const contactId = await findContactByIdentifiers({ userId, email })
  if (contactId) await exitRunsForContact(contactId, "payment")
} catch (err) {
  console.error("[stripe-webhook] sequence exit failed", (err as Error).message)
}
```

The booking hook is identical with `reason: "booking"` and the payload's
`contact_email` / `contact_phone`.

Required cases:

```ts
it("exits active runs when a checkout completes", async () => {})
it("does not fail the webhook when the contact cannot be resolved", async () => {})
it("does not fail the webhook when exitRunsForContact throws", async () => {})
it("resolves by user_id in preference to email", async () => {})
```

- [ ] **Steps:** failing tests → run → implement → run → mutation: make the hook rethrow and confirm the "does not fail the webhook" test fails → revert → commit.

```bash
git commit -m "feat(lead-engine): buying or booking ends the sales pitch"
```

---

## Task 10: Stage 1a debt — the merge becomes atomic

**Files:**
- Modify: `lib/db/contacts.ts` (`mergeContacts` → `.rpc()`)
- Modify: `lib/db/contact-consents.ts` (`hasConsent` tiebreak, `suppress` error code)
- Test: `__tests__/db/contacts-record-event.test.ts` (extend)
- Test: `__tests__/db/contact-consents.test.ts` (extend)

**Changes:**

1. `mergeContacts(survivorId, mergedId, businessId)` keeps its signature and
   becomes:

```ts
export async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()
  const { error } = await supabase.rpc("merge_contacts", {
    p_survivor: survivorId,
    p_merged: mergedId,
    p_business: businessId,
    p_reason: "email and phone resolved to different contacts",
  })
  if (error) throw error
}
```

   Replace the long comment block about non-atomicity with one that records what
   is now true: the merge runs in a single transaction inside
   `merge_contacts`, and the list of re-pointed children lives in
   `00217_lead_engine_sequence_functions.sql` and must be updated whenever a new
   table gains an FK onto `contacts(id)`.

2. `hasConsent` ordering gains the tiebreak:

```ts
.order("occurred_at", { ascending: false })
.order("created_at", { ascending: false })
.limit(1)
```

3. `suppress` matches the Postgres code:

```ts
if (error && (error as { code?: string }).code !== "23505") throw error
```

**Required new tests:**

```ts
it("hasConsent breaks an occurred_at tie by created_at, newest wins", async () => {
  // Two rows, identical occurred_at, granted true then false. Without the
  // tiebreak the winner is arbitrary. This is the assertion that must exist
  // BEFORE any marketing_consent_log backfill.
})

it("suppress swallows a real 23505 and rethrows anything else", async () => {
  // The old code matched the string "duplicate", so a genuine failure whose
  // message happened to contain that word was silently swallowed.
})

it("mergeContacts delegates to the merge_contacts RPC", async () => {})
```

- [ ] **Steps:** write the three tests → run (FAIL) → implement → run (PASS) → mutation: revert the tiebreak and confirm the tie test fails; change `23505` back to the string match and confirm the suppress test fails → revert both → commit.

```bash
git commit -m "fix(lead-engine): a merge is one transaction, and the newest consent record is knowable"
```

---

## Task 11: Timeline retention

**Files:**
- Create: `lib/db/contact-timeline-retention.ts`
- Create: `functions/src/lib/contact-timeline-retention.ts` (twin)
- Create: `app/api/admin/internal/contact-timeline-retention/route.ts`
- Modify: `functions/src/index.ts`, `lib/cron-catalog.ts`, `app/api/admin/automation/trigger/route.ts`, `lib/automation/automation-health-scanner.ts`
- Test: `__tests__/db/contact-timeline-retention.test.ts`

**Interfaces:**
- Produces (identical in both twins): `export async function scrubContactTimeline(supabase: SupabaseClient, days: number): Promise<number>`

Behaviour: for rows where `occurred_at < now() - days` **and** `scrubbed_at IS
NULL`, set `metadata = '{}'::jsonb` and `scrubbed_at = now()`. Return the count.
It does **not** delete the row — `kind`, `source` and `occurred_at` survive, and
they carry no personal data.

`functions/` has `rootDir: "src"` and cannot import from `lib/`, so the twin is
a copy. Note that in both file headers, pointing at each other, exactly as
`lib/db/cron-runs.ts` and `functions/src/lib/cron-runs.ts` do.

Settings: `contact_timeline_retention_days` (default 365) and flag
`cron_contact_timeline_retention_enabled`, default **true** — the same reasoning
as `cron_audit_log_retention_enabled`: unbounded PII accumulation is the risk
being managed, so the safe default is on. Schedule `30 3 * * *`, after the
audit-log prune at `0 3 * * *`.

Required cases:

```ts
it("scrubs metadata on rows older than the window", async () => {})
it("leaves kind, source and occurred_at intact", async () => {})
it("does not touch rows inside the window", async () => {})
it("does not re-scrub a row that already has scrubbed_at", async () => {})
it("returns the number of rows scrubbed", async () => {})
```

Add `"contactTimelineRetentionCron"` to the automation-health scanner's expected
list so a silent failure surfaces in the daily watchdog.

- [ ] **Steps:** failing tests → run → implement both twins → run → **diff the twins** (`diff lib/db/contact-timeline-retention.ts functions/src/lib/contact-timeline-retention.ts` — only the import lines and header should differ) → commit.

```bash
git commit -m "feat(lead-engine): a timeline keeps its shape and forgets its details"
```

---

## Task 12: Seed the four sequences

**Files:**
- Create: `supabase/migrations/00218_lead_engine_seed_sequences.sql`
- Test: `__tests__/lib/lead-engine/seed-sequences.test.ts`

**Before writing any copy, do the §11 audit.** For each candidate trigger source,
grep for what that entry point already emails the lead:

```bash
grep -rn "sendContactAutoReply\|sendInquiryAutoReply\|sendNewFunnelLeadEmail\|sendEventSignup\|sendWelcomeEmail" app/api/ | grep -v node_modules
```

Already verified 2026-08-18:

| Source | Already emails the lead? | First step may be immediate? |
|---|---|---|
| `funnel_form` | No — `sendNewFunnelLeadEmail` goes to the admin | **Yes** |
| `contact_form` | **Yes** — `sendContactAutoReply`, `app/api/contact/route.ts:94` | **No** — must open with a `wait` |

Audit `newsletter`, `lead_magnet`, `event_signup` and `assessment` yourself and
record the findings in the migration's header comment. A source that already
auto-replies gets a `wait` as step 0. **Two emails landing within a second of
each other is visible to every lead and is the failure this audit exists to
prevent.**

**The four sequences.** Seed with `status='draft'`, not `'active'` — the copy
needs Darren's review before anything can enrol, and `draft` means
`enrollIfTriggered` ignores them. Flipping to `active` is a one-row update, no
deploy.

Write them as `INSERT … ON CONFLICT (business_id, key) DO NOTHING` so the
migration is re-runnable. Steps reference their sequence by the `key`, via a
subselect, not by a hardcoded uuid.

Copy requirements: no brand literal (Task 5's scan covers this file), plain
sentences, `{{name}}` for personalisation, and every email must read sensibly if
`{{name}}` renders empty.

Required cases:

```ts
it("seeds exactly four sequences, all in draft", () => {})
it("gives every email step both a subject and a body", () => {})
it("opens with a wait on any source that already auto-replies", () => {})
it("uses no brand literal", () => {})  // re-run the Task 5 scan now the file exists
it("ends every sequence with a stop step", () => {})
```

- [ ] **Steps:** run the audit → write the migration → write the tests → run → re-run Task 5's brand scan now that the file exists → commit.

```bash
git commit -m "feat(lead-engine): four conversations, as data rather than code"
```

---

## Task 13: The claim race, against a real database

**Files:**
- Create: `__tests__/integration/lib/db/sequence-claim-race.test.ts`

This is the one test in the plan that cannot be a unit test. `SKIP LOCKED` is a
property of the database, and a mock that returns disjoint sets proves only that
the mock was written to. A test asserting the migration text contains the words
`SKIP LOCKED` is worth nothing.

**Preconditions.** The integration lane uses a real service-role client
(`__tests__/integration/_helpers/cleanup.ts`). Migrations `00212`–`00218` must
exist in the target database. They have **not** been applied anywhere. So:

1. Check whether the Lead Engine tables exist in the database `.env.local`
   points at (the clone, not production).
2. If they do not, **skip the suite with an explicit message** rather than
   failing:

```ts
const ready = await tablesExist(["sequences", "sequence_runs"])
describe.skipIf(!ready)("claim_sequence_runs under overlapping ticks", () => { … })
```

   A skipped test that says why is honest. A test that silently passes because
   there was nothing to test is the `null`-vs-empty error again.

3. Do **not** apply migrations to a shared database as part of a test run.
   Record in the task report whether the suite ran or skipped.

**The test itself:**

```ts
it("two concurrent claims return disjoint run sets", async () => {
  // Seed N=20 due runs. Fire two claim_sequence_runs calls concurrently with
  // different claim tokens and limit=20 each.
  const [a, b] = await Promise.all([
    claimDueRuns(20, "tick-a"),
    claimDueRuns(20, "tick-b"),
  ])
  const ids = new Set([...a, ...b].map(r => r.id))
  expect(ids.size).toBe(a.length + b.length)   // no id appears twice
  expect(a.length + b.length).toBeLessThanOrEqual(20)
})

it("does not re-claim a run claimed less than 10 minutes ago", async () => {})
it("re-claims a run whose claim is older than 10 minutes", async () => {})
```

- [ ] **Steps:** write the suite → run it → record honestly whether it executed or skipped, and why → commit.

```bash
git commit -m "test(lead-engine): prove the claim is atomic where it can actually be proven"
```

---

## Final verification (run after Task 13, before any review)

```bash
# Targeted — every suite this branch created or touched.
npx vitest run __tests__/lib/lead-engine __tests__/lib/automation/sequence-tick.test.ts \
  __tests__/db/sequences.test.ts __tests__/db/contacts-record-event.test.ts \
  __tests__/db/contact-consents.test.ts __tests__/db/contact-timeline-retention.test.ts \
  __tests__/api/admin/internal/sequence-tick.test.ts __tests__/api/funnel-submit-contact.test.ts \
  __tests__/api/webhooks/sequence-exit-hooks.test.ts

# Compare the TOTAL against the 258 baseline. Do not grep for your own
# filenames — 258 pre-existing errors will hide a new one in a file you did
# not expect to touch.
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: all suites green; `tsc` count **exactly 258**. A count of 259+ means
this branch introduced an error — find it by diffing the full error list against
a run on `main`.

## Cascade re-review (mandatory, spec §10)

Stage 1a's one real bug was a merge that cascade-deleted a child table added in
a later task. Before declaring this branch done:

```bash
grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql
```

**Expect five hits**, not four — an earlier draft of this plan and of spec §10
both said four and both were wrong; `contact_merges.survivor_id` (`00213:51`)
cascades too. For each hit, confirm it is either re-pointed in `merge_contacts`
(`00217`) or explicitly exempt with a stated reason (`contact_merges.merged_id`
carries no FK by design; `contact_suppressions` is keyed by identifier, not
`contact_id`). If the grep returns a sixth row, the function is wrong until
proven otherwise. Do not delegate this to per-task review
— no single task's reviewer can see the interaction.

---

## Self-Review

**Spec coverage:** §3.1 tables → Task 1. §3.2 indexes → Task 1. §3.3 functions →
Tasks 1, 10. §4 tick → Tasks 3, 4, 8. §5 guardrails → Task 2. §6 steps and
branch predicates → Task 3. §7 enrolment → Task 7; exits → Tasks 6, 9. §8 email
and unsubscribe → Tasks 5, 6. §9.1 merge → Tasks 1, 10. §9.2 consent tiebreak →
Tasks 1, 10. §9.3 retention → Tasks 1, 11. §9.4 suppress code → Task 10. §10
cascade → Task 1 plus the mandatory re-review above. §11 seed and audit → Task
12. §12 testing → every task, with the claim race at Task 13. §13 deploy →
Task 8 wiring. No spec section is unimplemented.

**One gap found and closed:** the spec's §6 consent rule did not say which
channel required opt-in. Left unstated, an implementer would gate email on
`hasConsent` and ship an engine that can never send, because Stage 1a writes no
consent row. Task 3 now states the regime — email opt-out, SMS opt-in — with
tests for both.

**Type consistency:** `SequenceRunRow` / `SequenceStepRow` / `DecisionContext` /
`StepAction` are defined once in Task 3 and consumed unchanged by Tasks 4 and 8.
`exitRunsForContact(contactId, reason)` has one signature across Tasks 4, 6 and
9. `getBusinessSettings()` field names match `lib/db/businesses.ts` as it exists
today.
