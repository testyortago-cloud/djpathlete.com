# Lead Engine Stage 1c — Pipeline Board and Campaign-to-Revenue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pipeline board whose cards are created and moved by events the repo
already emits, plus a report tracing won revenue back to the campaign that produced it.

**Architecture:** Four new tables (`pipelines`, `pipeline_stages`, `opportunities`,
`opportunity_stage_events`). All movement logic lives in one pure function,
`decideMove`, which imports no database client — the same shape as Stage 1b's
`decideStep`. Two existing webhooks call it; a gated reconciler cron repairs anything
a dropped webhook missed. Campaign-to-revenue is a read-time join over columns that
already exist.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (plpgsql for the merge),
Vitest, `@dnd-kit` for drag, `components/ui/data-table.tsx` for tables.

**Spec:** `docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md`
— binding authority. Read it before Task 1. Parent:
`docs/superpowers/specs/2026-08-18-lead-engine-design.md` §8.

## Global Constraints

- **`business_id` on every new table**, `NOT NULL DEFAULT
  '00000000-0000-0000-0000-000000000001'`, FK to `businesses(id)` ON DELETE CASCADE.
- **No brand literals** anywhere in new code. Business identity comes from
  `business_settings` via `lib/db/businesses.ts`. Task 8 extends the existing
  `no-brand-literals` scan to cover every file this plan creates.
- **`users` owns login and billing; `contacts` owns marketing.** Nothing gets
  re-pointed.
- **Migrations race Vercel on merge.** Code must tolerate the old schema for one
  deploy: an absent column is not a null value.
- **Tables use `components/ui/data-table.tsx`.** Never hand-roll a `<table>`.
- **New audited actions need slugs** in the closed taxonomy `lib/audit/actions.ts`.
- **Targeted tests only.** `npx vitest run <path>` plus `npx tsc --noEmit`.
- **tsc baseline is 251**, measured on `main` at `89aabaa8` on 2026-08-19. This is
  NOT the 258 quoted by the Stage 1a/1b plans. Compare the **total**; never grep for
  your own filenames. Re-measure on `main` if it has moved.
- **A falling tsc count needs explaining as much as a rising one.** Seven fixed and
  seven introduced also nets to zero. Normalise line/column out of both lists and
  `comm` them.
- **Mutation discipline.** "This test would fail if X" is a guess until X has been
  applied and the failure observed. Apply it, record the observed failure, revert.
- **Mocks must actually filter.** Stage 1a shipped two Supabase mocks that ignored
  `.eq()` entirely, making every assertion pass trivially. Copy the mock in
  `__tests__/db/sequences.test.ts`, which tracks filters and narrows for real.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/00219_lead_engine_pipeline.sql` | Four tables, indexes, seeded Coaching board |
| `supabase/migrations/00220_lead_engine_pipeline_merge.sql` | `merge_contacts` v2 — re-point opportunities, keep earliest first touch |
| `lib/lead-engine/pipeline-move.ts` | **Pure.** `decideMove` + `stalenessOf`. No DB client, no I/O |
| `lib/db/pipeline.ts` | All pipeline reads/writes. The only file that talks to the four tables |
| `lib/automation/pipeline-reconcile.ts` | Pure aggregator: what the hooks missed |
| `lib/automation/campaign-revenue.ts` | Pure aggregator: attribution → won value |
| `app/api/admin/internal/pipeline-reconcile/route.ts` | Auth/gate/logging shell |
| `app/(admin)/admin/pipeline/page.tsx` | The board |
| `app/api/admin/pipeline/move/route.ts` | Manual drag endpoint |

Tasks 1–7 are logic and are fully specified below. Tasks 8–9 are UI over already-tested
readers.

---

## Task 1: Schema — four tables and the seeded board

**Files:**
- Create: `supabase/migrations/00219_lead_engine_pipeline.sql`
- Test: `__tests__/lib/lead-engine/pipeline-schema.test.ts`

**Interfaces:**
- Produces: tables `pipelines`, `pipeline_stages`, `opportunities`,
  `opportunity_stage_events`; seeded pipeline `key='coaching'` with stages
  `consult_booked`(1,open) `consulted`(2,open) `won`(3,won) `lost`(4,lost).

- [ ] **Step 1: Write `00219_lead_engine_pipeline.sql`**

```sql
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
  closed_trigger text CHECK (closed_trigger IN ('manual','booking','payment','reconciler')),
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
```

- [ ] **Step 2: Verify the SQL parses against a real Postgres**

Use the local throwaway cluster the Stage 1b race test documents:

```bash
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
# apply 00212..00219 into a scratch database, then:
psql "$SCRATCH_DB" -c "\d public.opportunities"
psql "$SCRATCH_DB" -c "SELECT key, position, kind FROM public.pipeline_stages ORDER BY position;"
```
Expected: four stages in position order, `won`/`lost` kinds last.

If no local cluster is reachable, say so explicitly in the task report rather than
claiming the migration was verified. Do not fake this.

- [ ] **Step 3: Write the seed-shape test**

```ts
// __tests__/lib/lead-engine/pipeline-schema.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/00219_lead_engine_pipeline.sql"),
  "utf8",
)

describe("00219 pipeline schema", () => {
  it("puts business_id on all four tables", () => {
    const tables = sql.split("CREATE TABLE").slice(1)
    expect(tables).toHaveLength(4)
    for (const t of tables) expect(t).toContain("business_id")
  })

  it("keys the state machine on kind, and constrains it to three values", () => {
    expect(sql).toContain("kind        text NOT NULL CHECK (kind IN ('open','won','lost'))")
  })

  it("allows only one open opportunity per contact per pipeline", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]*opportunities \(contact_id, pipeline_id\) WHERE outcome IS NULL/)
  })

  it("does not decide finality from closed_by_user_id", () => {
    // Spec §2.4: ON DELETE SET NULL would un-pin cards when an admin is deleted.
    expect(sql).toContain("closed_trigger text CHECK")
  })

  it("seeds exactly one pipeline and four stages", () => {
    expect(sql.match(/INSERT INTO public.pipelines/g)).toHaveLength(1)
    for (const key of ["consult_booked", "consulted", "won", "lost"]) {
      expect(sql).toContain(`'${key}'`)
    }
  })

  it("contains no brand literals", () => {
    expect(sql.toLowerCase()).not.toContain("djpathlete")
    expect(sql.toLowerCase()).not.toContain("darren")
  })
})
```

- [ ] **Step 4: Run it**

Run: `npx vitest run __tests__/lib/lead-engine/pipeline-schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00219_lead_engine_pipeline.sql __tests__/lib/lead-engine/pipeline-schema.test.ts
git commit -m "feat(lead-engine): a board, its stages, and the deals that move across it"
```

---

## Task 2: `merge_contacts` v2 — opportunities and the earliest first touch

**Files:**
- Create: `supabase/migrations/00220_lead_engine_pipeline_merge.sql`
- Modify: `supabase/tests/merge_contacts_scenarios.sql` (add scenarios)

**Interfaces:**
- Consumes: `opportunities` from Task 1.
- Produces: `merge_contacts(p_survivor, p_merged, p_business, p_reason)` unchanged
  in signature.

**Why this task exists.** Stage 1a shipped a merge that cascade-deleted a child table
added by a later task, destroying consent evidence. Task 1 adds a sixth cascading
child. And `first_touch_session_id` — unread until now — becomes the root of every
number in the campaign-to-revenue report, so a merge that keeps the *wrong* one
silently misattributes revenue.

- [ ] **Step 1: Run the cascade grep and read it before writing anything**

```bash
grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql
```
Expected after Task 1: **seven lines, six real FKs.** The seventh (`00217:50`) is the
instructional comment inside `merge_contacts` itself, not an FK. If you count a
seventh *real* FK, stop — something exists that this plan did not account for.

- [ ] **Step 2: Write `00220_lead_engine_pipeline_merge.sql`**

Copy the whole `merge_contacts` body from `00217` and add the two blocks below.
`CREATE OR REPLACE FUNCTION` replaces it wholesale — do NOT hand-edit `00217`, which
has already been applied to production.

Insert **before** the `DELETE FROM public.contacts` line:

```sql
  -- Sixth cascading child (Stage 1c). Contested open deals: the partial unique
  -- index allows one open opportunity per (contact, pipeline), so moving the
  -- loser's open card into a pipeline the survivor is already open in would
  -- fail. Keep whichever is FURTHER ALONG — a higher stage position has already
  -- consumed the earlier stages — tie-broken by earlier created_at then id,
  -- mirroring the rule already applied to sequence_runs above.
  WITH contested AS (
    SELECT l.id AS loser_opp,
           CASE
             WHEN ls.position > ss.position THEN s.id
             WHEN ls.position < ss.position THEN l.id
             WHEN l.created_at < s.created_at THEN s.id
             WHEN l.created_at > s.created_at THEN l.id
             WHEN l.id < s.id THEN s.id
             ELSE l.id
           END AS lagging_opp
      FROM public.opportunities l
      JOIN public.pipeline_stages ls ON ls.id = l.stage_id
      JOIN public.opportunities s
        ON  s.pipeline_id = l.pipeline_id
        AND s.contact_id  = p_survivor
        AND s.outcome IS NULL
      JOIN public.pipeline_stages ss ON ss.id = s.stage_id
     WHERE l.contact_id = p_merged
       AND l.outcome IS NULL
  )
  UPDATE public.opportunities o
     SET outcome        = 'lost',
         outcome_reason = 'merged_into_survivor',
         closed_at      = now(),
         closed_trigger = 'reconciler',
         updated_at     = now()
    FROM contested c
   WHERE o.id = c.lagging_opp;

  UPDATE public.opportunities SET contact_id = p_survivor WHERE contact_id = p_merged;

  -- First touch must be the EARLIEST of the two, not the survivor's by default.
  -- Stage 1c makes this column the root of campaign-to-revenue; keeping the wrong
  -- one misattributes every dollar of that contact's revenue to the wrong campaign.
  IF v_loser.first_touch_session_id IS NOT NULL THEN
    IF v_survivor.first_touch_session_id IS NULL THEN
      UPDATE public.contacts
         SET first_touch_session_id = v_loser.first_touch_session_id, updated_at = now()
       WHERE id = p_survivor;
    ELSE
      DECLARE
        v_surv_touch timestamptz;
        v_lose_touch timestamptz;
      BEGIN
        SELECT COALESCE(MIN(ma.first_seen_at), v_survivor.created_at) INTO v_surv_touch
          FROM public.marketing_attribution ma
         WHERE ma.session_id = v_survivor.first_touch_session_id;
        SELECT COALESCE(MIN(ma.first_seen_at), v_loser.created_at) INTO v_lose_touch
          FROM public.marketing_attribution ma
         WHERE ma.session_id = v_loser.first_touch_session_id;
        IF v_lose_touch < v_surv_touch THEN
          UPDATE public.contacts
             SET first_touch_session_id = v_loser.first_touch_session_id, updated_at = now()
           WHERE id = p_survivor;
        END IF;
      END;
    END IF;
  END IF;
```

Also update the comment block above the function: it currently says "all five
cascade". It is now six. The Stage 1b comment explicitly warns that this count has
been wrong twice — leave it correct.

- [ ] **Step 3: Add SQL scenarios**

Append to `supabase/tests/merge_contacts_scenarios.sql`, following the existing file's
assertion style:

1. Loser has an open opportunity, survivor has none → survivor owns it, still open.
2. Both have an open opportunity in the same pipeline, loser further along → the
   SURVIVOR's is closed `merged_into_survivor`, the loser's survives and is
   re-pointed. (This is the assertion that fails if someone "simplifies" the
   contested block to always keep the survivor's.)
3. Survivor's `first_touch_session_id` is NULL, loser's is set → survivor takes it.
4. Both set, loser's attribution row is older → survivor takes the loser's.
5. Both set, survivor's is older → survivor keeps its own.
6. Loser's `first_touch_session_id` set but has no `marketing_attribution` row →
   falls back to `contacts.created_at`, no crash.

- [ ] **Step 4: Run the scenarios against the local cluster**

```bash
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
psql "$SCRATCH_DB" -f supabase/tests/merge_contacts_scenarios.sql
```
Expected: every assertion passes. If the cluster is unreachable, report that honestly
in the task report — do not claim SQL-level verification you did not perform.

- [ ] **Step 5: Mutation — prove scenario 2 bites**

Change the contested `CASE` to always return `l.id` (always keep the survivor's).
Re-run. Expected: scenario 2 FAILS. Record the observed failure, then revert.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00220_lead_engine_pipeline_merge.sql supabase/tests/merge_contacts_scenarios.sql
git commit -m "fix(lead-engine): a merge keeps the earliest first touch, and the deal further along"
```

---
## Task 3: The pure decision core

**Files:**
- Create: `lib/lead-engine/pipeline-move.ts`
- Test: `__tests__/lib/lead-engine/pipeline-move.test.ts`

**Interfaces:**
- Produces: `decideMove(ctx: MoveContext, event: PipelineEvent): MoveDecision`,
  `stalenessOf(stage, enteredStageAt, now): Staleness`,
  `REBOOKING_SUPPRESSION_DAYS`, and all types below. Tasks 4–7 consume these
  unchanged.

**This module imports nothing but types.** No `@/lib/supabase`, no DAL, no I/O —
that purity is why its tests need zero mocks, exactly like
`lib/automation/sequence-tick.ts`. The impure caller (Task 4) does the writing.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/lead-engine/pipeline-move.test.ts
import { describe, it, expect } from "vitest"
import {
  decideMove,
  stalenessOf,
  REBOOKING_SUPPRESSION_DAYS,
  type MoveContext,
  type StageRow,
} from "@/lib/lead-engine/pipeline-move"

const STAGES: StageRow[] = [
  { id: "s1", key: "consult_booked", position: 1, kind: "open", amber_after_days: 3, red_after_days: 7 },
  { id: "s2", key: "consulted",      position: 2, kind: "open", amber_after_days: 5, red_after_days: 14 },
  { id: "s3", key: "won",            position: 3, kind: "won",  amber_after_days: null, red_after_days: null },
  { id: "s4", key: "lost",           position: 4, kind: "lost", amber_after_days: null, red_after_days: null },
]

const NOW = new Date("2026-08-19T12:00:00Z")

function ctx(over: Partial<MoveContext> = {}): MoveContext {
  return { now: NOW, stages: STAGES, current: null, ...over }
}

function openAt(key: string, enteredIso = "2026-08-19T09:00:00Z") {
  const s = STAGES.find((x) => x.key === key)!
  return {
    id: "opp-1", stage_id: s.id, stage_position: s.position, stage_kind: s.kind,
    entered_stage_at: enteredIso, outcome: null, closed_trigger: null, closed_at: null,
  }
}

function closedAt(outcome: "won" | "lost", trigger: "manual" | "booking" | "payment" | "reconciler", closedIso: string) {
  const s = STAGES.find((x) => x.kind === outcome)!
  return {
    id: "opp-1", stage_id: s.id, stage_position: s.position, stage_kind: s.kind,
    entered_stage_at: closedIso, outcome, closed_trigger: trigger, closed_at: closedIso,
  }
}

describe("decideMove — creation", () => {
  it("creates a card at Consult Booked when a booking is scheduled and nothing exists", () => {
    const d = decideMove(ctx(), { kind: "booking", status: "scheduled", occurredAt: NOW })
    expect(d).toEqual({ kind: "create", toStageKey: "consult_booked", trigger: "booking" })
  })

  it("creates directly at Consulted when the scheduled webhook was missed", () => {
    // The consult demonstrably happened; a dropped 'scheduled' hook must not
    // cost us the card.
    const d = decideMove(ctx(), { kind: "booking", status: "completed", occurredAt: NOW })
    expect(d).toEqual({ kind: "create", toStageKey: "consulted", trigger: "booking" })
  })

  it("creates an already-won card when a payment arrives with no prior deal", () => {
    const d = decideMove(ctx(), { kind: "payment", amountCents: 120000, currency: "usd", occurredAt: NOW })
    expect(d).toMatchObject({ kind: "create", toStageKey: "won", outcome: "won", valueCents: 120000 })
  })
})

describe("decideMove — advancing, and never backwards", () => {
  it("advances Consult Booked to Consulted on booking.completed", () => {
    const d = decideMove(ctx({ current: openAt("consult_booked") }), {
      kind: "booking", status: "completed", occurredAt: NOW,
    })
    expect(d).toEqual({ kind: "advance", toStageKey: "consulted", trigger: "booking" })
  })

  it("does NOT move a Consulted card back on a later booking.scheduled", () => {
    const d = decideMove(ctx({ current: openAt("consulted") }), {
      kind: "booking", status: "scheduled", occurredAt: NOW,
    })
    expect(d.kind).toBe("noop")
  })

  it("wins an open card on payment", () => {
    const d = decideMove(ctx({ current: openAt("consulted") }), {
      kind: "payment", amountCents: 95000, currency: "usd", occurredAt: NOW,
    })
    expect(d).toMatchObject({ kind: "close", outcome: "won", valueCents: 95000, trigger: "payment" })
  })

  it("loses an open card on a cancellation, recording which kind", () => {
    const d = decideMove(ctx({ current: openAt("consult_booked") }), {
      kind: "booking", status: "no_show", occurredAt: NOW,
    })
    expect(d).toMatchObject({ kind: "close", outcome: "lost", reason: "booking_no_show" })
  })
})

describe("decideMove — a human's close is final (spec §2.4)", () => {
  it("refuses to win a card a human marked Lost", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", "2026-08-18T12:00:00Z") }),
      { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: NOW },
    )
    expect(d).toEqual({ kind: "refuse", reason: "human_close_is_final" })
  })

  it("DOES win a card the system auto-lost — a no-show who later pays", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "booking", "2026-08-18T12:00:00Z") }),
      { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: NOW },
    )
    expect(d).toMatchObject({ kind: "close", outcome: "won", valueCents: 50000 })
  })

  it("refuses a new card when they re-book inside the suppression window", () => {
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", "2026-08-10T12:00:00Z") }), // 9 days
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d).toEqual({ kind: "refuse", reason: "suppressed_after_manual_lost" })
  })

  it("allows a new card once the suppression window has passed", () => {
    const past = new Date(NOW.getTime() - (REBOOKING_SUPPRESSION_DAYS + 1) * 86400000)
    const d = decideMove(
      ctx({ current: closedAt("lost", "manual", past.toISOString()) }),
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d.kind).toBe("create")
  })

  it("treats a re-booking after a WON deal as a new deal, not a suppression", () => {
    const d = decideMove(
      ctx({ current: closedAt("won", "manual", "2026-08-18T12:00:00Z") }),
      { kind: "booking", status: "scheduled", occurredAt: NOW },
    )
    expect(d.kind).toBe("create")
  })
})

describe("stalenessOf", () => {
  const stage = STAGES[0] // amber 3, red 7

  it("is fresh below the amber threshold", () => {
    expect(stalenessOf(stage, "2026-08-17T12:00:00Z", NOW)).toBe("fresh") // 2 days
  })

  it("turns amber exactly ON the amber threshold", () => {
    expect(stalenessOf(stage, "2026-08-16T12:00:00Z", NOW)).toBe("amber") // 3 days
  })

  it("turns red exactly ON the red threshold", () => {
    expect(stalenessOf(stage, "2026-08-12T12:00:00Z", NOW)).toBe("red") // 7 days
  })

  it("never marks a closed card stale", () => {
    expect(stalenessOf(STAGES[3], "2020-01-01T00:00:00Z", NOW)).toBe("fresh")
  })

  it("is fresh when the stage sets no thresholds", () => {
    const noThresh = { ...stage, amber_after_days: null, red_after_days: null }
    expect(stalenessOf(noThresh, "2020-01-01T00:00:00Z", NOW)).toBe("fresh")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/lib/lead-engine/pipeline-move.test.ts`
Expected: FAIL — cannot resolve `@/lib/lead-engine/pipeline-move`.

- [ ] **Step 3: Implement `lib/lead-engine/pipeline-move.ts`**

```ts
// Pure decision core for the Lead Engine pipeline board.
//
// This module must import NOTHING but types — no `@/lib/supabase`, no DAL, no
// I/O. That purity is what lets its tests run with zero mocks, the same
// contract as lib/automation/sequence-tick.ts. The impure caller
// (lib/db/pipeline.ts) performs the writes this function describes.
//
// Spec: docs/superpowers/specs/2026-08-19-lead-engine-stage1c-pipeline-design.md §4

export type StageKind = "open" | "won" | "lost"
export type MoveTrigger = "booking" | "payment" | "manual" | "reconciler"
export type Staleness = "fresh" | "amber" | "red"

export type StageRow = {
  id: string
  key: string
  position: number
  kind: StageKind
  amber_after_days: number | null
  red_after_days: number | null
}

/** The most recent opportunity for a (contact, pipeline) — open OR closed. */
export type OpportunityState = {
  id: string
  stage_id: string
  stage_position: number
  stage_kind: StageKind
  entered_stage_at: string
  outcome: "won" | "lost" | null
  closed_trigger: MoveTrigger | null
  closed_at: string | null
}

export type MoveContext = {
  now: Date
  stages: StageRow[]
  current: OpportunityState | null
}

export type PipelineEvent =
  | { kind: "booking"; status: "scheduled" | "completed" | "cancelled" | "no_show"; occurredAt: Date }
  | { kind: "payment"; amountCents: number; currency: string; occurredAt: Date }

export type MoveDecision =
  | { kind: "create"; toStageKey: string; trigger: MoveTrigger; outcome?: "won" | "lost"; valueCents?: number; currency?: string; reason?: string }
  | { kind: "advance"; toStageKey: string; trigger: MoveTrigger }
  | { kind: "close"; outcome: "won" | "lost"; toStageKey: string; reason: string; trigger: MoveTrigger; valueCents?: number; currency?: string }
  | { kind: "refuse"; reason: string }
  | { kind: "noop"; reason: string }

/**
 * How long a human's Lost suppresses a brand-new card for the same contact.
 *
 * Without this, spec §2.4 has a side door: the unique index only constrains
 * OPEN opportunities, so a lead Darren ruled out could book again and arrive as
 * a fresh card — back in the working set by another route. Stated default, not a
 * derived number; spec §13 lists it for confirmation.
 */
export const REBOOKING_SUPPRESSION_DAYS = 30

const DAY_MS = 86_400_000

function stageByKey(stages: StageRow[], key: string): StageRow {
  const s = stages.find((x) => x.key === key)
  if (!s) throw new Error(`pipeline stage not configured: ${key}`)
  return s
}

function firstOpenStage(stages: StageRow[]): StageRow {
  const open = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)
  if (!open.length) throw new Error("pipeline has no open stage")
  return open[0]
}

function stageOfKind(stages: StageRow[], kind: StageKind): StageRow {
  const s = stages.find((x) => x.kind === kind)
  if (!s) throw new Error(`pipeline has no ${kind} stage`)
  return s
}

/** Target stage for a booking status, or null when the status does not advance. */
function bookingTarget(stages: StageRow[], status: string): StageRow | null {
  if (status === "scheduled") return firstOpenStage(stages)
  if (status === "completed") {
    // The second open stage if configured, else the only one.
    const open = stages.filter((s) => s.kind === "open").sort((a, b) => a.position - b.position)
    return open[1] ?? open[0]
  }
  return null
}

export function decideMove(ctx: MoveContext, event: PipelineEvent): MoveDecision {
  const { current, stages, now } = ctx

  // A close made by a person is final. A close made by the system is a guess and
  // stays correctable — a no-show who later pays becomes Won. Note this reads
  // closed_trigger, never closed_by_user_id: see the schema comment in 00219.
  const humanClosed = current?.outcome != null && current.closed_trigger === "manual"

  if (event.kind === "payment") {
    if (humanClosed) return { kind: "refuse", reason: "human_close_is_final" }
    const won = stageOfKind(stages, "won")
    if (!current) {
      return {
        kind: "create", toStageKey: won.key, trigger: "payment",
        outcome: "won", valueCents: event.amountCents, currency: event.currency,
      }
    }
    if (current.outcome === "won") return { kind: "noop", reason: "already_won" }
    return {
      kind: "close", outcome: "won", toStageKey: won.key, reason: "payment_received",
      trigger: "payment", valueCents: event.amountCents, currency: event.currency,
    }
  }

  // --- booking ---
  if (event.status === "cancelled" || event.status === "no_show") {
    if (!current || current.outcome != null) return { kind: "noop", reason: "no_open_deal" }
    return {
      kind: "close", outcome: "lost", toStageKey: stageOfKind(stages, "lost").key,
      reason: event.status === "no_show" ? "booking_no_show" : "booking_cancelled",
      trigger: "booking",
    }
  }

  const target = bookingTarget(stages, event.status)
  if (!target) return { kind: "noop", reason: "booking_status_does_not_move" }

  if (!current) return { kind: "create", toStageKey: target.key, trigger: "booking" }

  if (current.outcome != null) {
    // Closed. A new booking is a new deal — unless a human recently ruled them
    // out, in which case the side door stays shut.
    if (humanClosed && current.outcome === "lost" && current.closed_at) {
      const age = now.getTime() - new Date(current.closed_at).getTime()
      if (age < REBOOKING_SUPPRESSION_DAYS * DAY_MS) {
        return { kind: "refuse", reason: "suppressed_after_manual_lost" }
      }
    }
    return { kind: "create", toStageKey: target.key, trigger: "booking" }
  }

  // Open. Forward only — a late booking.scheduled must not drag a Consulted card
  // backwards.
  if (target.position <= current.stage_position) {
    return { kind: "noop", reason: "would_move_backwards" }
  }
  return { kind: "advance", toStageKey: target.key, trigger: "booking" }
}

/**
 * Staleness is computed at read time and NEVER stored (spec §8) — a stored flag
 * is wrong the moment the clock moves and needs a job to keep true.
 */
export function stalenessOf(stage: StageRow, enteredStageAt: string, now: Date): Staleness {
  if (stage.kind !== "open") return "fresh"
  const days = Math.floor((now.getTime() - new Date(enteredStageAt).getTime()) / DAY_MS)
  if (stage.red_after_days != null && days >= stage.red_after_days) return "red"
  if (stage.amber_after_days != null && days >= stage.amber_after_days) return "amber"
  return "fresh"
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run __tests__/lib/lead-engine/pipeline-move.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Run the mutations — apply each, observe, revert**

Do not reason about these. Apply, run, record the real output, revert.

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | `humanClosed` ignores `closed_trigger` (always false) | "refuses to win a card a human marked Lost" |
| 2 | `humanClosed` returns true for any close | "DOES win a card the system auto-lost" |
| 3 | Change `target.position <= current.stage_position` to `<` | "does NOT move a Consulted card back" |
| 4 | Change `days >= amber_after_days` to `>` | "turns amber exactly ON the amber threshold" |
| 5 | Drop the `REBOOKING_SUPPRESSION_DAYS` age check | "refuses a new card when they re-book inside the window" |
| 6 | `stalenessOf` drops the `kind !== "open"` guard | "never marks a closed card stale" |

Record each observed failure in the task report. A mutation that does NOT break a
test means coverage is missing — add the test before moving on.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/pipeline-move.ts __tests__/lib/lead-engine/pipeline-move.test.ts
git commit -m "feat(lead-engine): the board decides where a card belongs without touching the database"
```

---
## Task 4: The pipeline DAL

**Files:**
- Create: `lib/db/pipeline.ts`
- Modify: `lib/audit/actions.ts`
- Test: `__tests__/db/pipeline.test.ts`

**Interfaces:**
- Consumes: `decideMove`, `stalenessOf`, all types from Task 3.
- Produces, consumed unchanged by Tasks 5–9:
  - `applyPipelineEvent(input: { contactId: string; event: PipelineEvent; pipelineKey?: string }): Promise<{ decision: MoveDecision; opportunityId: string | null }>`
  - `moveOpportunityManually(input: { opportunityId: string; toStageKey: string; actorUserId: string }): Promise<void>`
  - `readBoard(pipelineKey?: string): Promise<BoardColumn[]>`
  - `type BoardColumn = { stage: StageRow; cards: BoardCard[] }`
  - `type BoardCard = { id: string; contactId: string; contactName: string | null; enteredStageAt: string; staleness: Staleness; valueCents: number | null }`

`pipelineKey` defaults to `"coaching"`. That default is a **stage key, not a brand
literal** — it names a seeded row, and the no-brand-literals scan should still pass.

- [ ] **Step 1: Add the audit slugs**

In `lib/audit/actions.ts`, following the existing shape:

```ts
  { slug: "pipeline.opportunity_created", category: "automation", description: "Pipeline card created by an event" },
  { slug: "pipeline.opportunity_moved", category: "admin_write", description: "Pipeline card moved by an admin" },
  { slug: "pipeline.opportunity_won", category: "commerce", description: "Pipeline card closed won" },
  { slug: "pipeline.opportunity_lost", category: "commerce", description: "Pipeline card closed lost" },
```

- [ ] **Step 2: Write the failing tests**

Copy the mock harness from `__tests__/db/sequences.test.ts` verbatim — it tracks
`.eq()`/`.gte()`/`.lt()` filters and narrows rows for real. Do **not** hand-roll a
simpler one; a mock that ignores `.eq()` makes every assertion below pass trivially,
which is exactly how Stage 1a shipped two worthless suites.

Cover at minimum:

```ts
describe("applyPipelineEvent", () => {
  it("creates a card in the first open stage on booking.scheduled")
  it("writes an opportunity_stage_events row with trigger='booking' and from_stage_id=null on creation")
  it("copies contacts.first_touch_session_id into source_session_id at creation")
  it("does NOT update source_session_id on a later move")   // spec §3.3
  it("advances an existing card and stamps a fresh entered_stage_at")
  it("sets outcome/closed_at/closed_trigger together on a win")  // the CHECK constraint
  it("records a refused event with refused_reason and does not move the card")
  it("is scoped to the right contact — a second contact's card is untouched")
})

describe("readBoard", () => {
  it("returns one column per stage in position order")
  it("computes staleness at read time and stores nothing")
  it("omits closed cards from open columns")
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run __tests__/db/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/db/pipeline.ts`**

Structure (write the full bodies; this is the shape, not a placeholder):

- `resolvePipeline(key)` — read `pipelines` + `pipeline_stages`, ordered by position.
  Throw a named error if the board is not seeded; the caller decides whether that is
  fatal. Follow `BusinessNotConfiguredError` in `lib/lead-engine/email.ts` for the
  precedent: a misconfiguration must not make a scheduler retry forever.
- `readMostRecentOpportunity(contactId, pipelineId)` — newest by `created_at`, open
  or closed, mapped into `OpportunityState` (join `pipeline_stages` for
  `stage_position`/`stage_kind`).
- `applyPipelineEvent` — resolve → build `MoveContext` → `decideMove` → switch on
  the decision:
  - `create`: insert, copying `contacts.first_touch_session_id` into
    `source_session_id`; insert a stage event with `from_stage_id: null`;
    `recordAudit("pipeline.opportunity_created", …)`.
  - `advance`: update `stage_id` + `entered_stage_at = now()`; stage event.
  - `close`: update `outcome`, `closed_at`, `closed_trigger`, `value_cents`,
    `currency`, `stage_id`; stage event; audit `…_won` / `…_lost`.
  - `refuse`: insert a stage event carrying `refused_reason` and **no** stage
    change. This is the whole point of §2.4 — a suppressed move must be visible.
  - `noop`: write nothing.
- `moveOpportunityManually` — sets `closed_trigger='manual'` and `closed_by_user_id`
  when the target stage's `kind` is `won`/`lost`. This is what makes a human close
  final.
- `readBoard` — one query per board, `stalenessOf` applied in memory.

**Error handling:** check `error` on every Supabase call and throw. Stage 1a shipped
writes whose errors were never inspected; `89db013b` fixed it. Never treat a failed
read as an empty result — for a list a decision is made against, that inverts the
answer.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run __tests__/db/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the mock actually filters**

Delete the `.eq("contact_id", …)` filter in `readMostRecentOpportunity`. Re-run.
Expected: "is scoped to the right contact" FAILS. Record the observed output, revert.
If it still passes, the mock is not filtering and every test in this file is
worthless — fix the mock before continuing.

- [ ] **Step 7: Commit**

```bash
git add lib/db/pipeline.ts lib/audit/actions.ts __tests__/db/pipeline.test.ts
git commit -m "feat(lead-engine): the board's reads and writes, and the refusals it records"
```

---

## Task 5: The webhook hooks

**Files:**
- Modify: `app/api/webhooks/ghl-booking/route.ts` (beside the existing
  `exitRunsForContact` block, ~line 129)
- Modify: `app/api/stripe/webhook/route.ts` (beside the existing block, ~line 115)
- Test: `__tests__/api/webhooks/pipeline-hooks.test.ts`

**Interfaces:**
- Consumes: `applyPipelineEvent` from Task 4.

Both webhooks already resolve a contact and call `exitRunsForContact` inside a
try/catch that logs and never rethrows. Card movement joins them under the same
discipline, in the same block.

- [ ] **Step 1: Write the failing tests**

```ts
describe("GHL booking webhook — pipeline", () => {
  it("creates a card when a booking is scheduled")
  it("advances the card when the booking completes")
  it("closes the card lost on cancelled, with reason booking_cancelled")
  it("closes the card lost on no_show, with reason booking_no_show")
  it("does not fail the webhook when applyPipelineEvent throws")   // returns 200
  it("does not call applyPipelineEvent when no contact resolves")
})

describe("Stripe webhook — pipeline", () => {
  it("wins the card on checkout.session.completed, with the session amount")
  it("passes the session currency through")
  it("does not fail the webhook when applyPipelineEvent throws")
})
```

The "does not fail the webhook" tests matter most: Stripe retries a 500 and GHL may
not, so a bug in our board must never cost a booking record.

- [ ] **Step 2: Run (FAIL) → implement → run (PASS)**

In `ghl-booking/route.ts`, extend the existing try block rather than adding a second
one — one contact resolution, both consumers:

```ts
    try {
      const contactId = await findContactByIdentifiers({
        email: data.contact_email,
        phone: data.contact_phone,
      })
      if (contactId) {
        if (data.status === "scheduled" || data.status === "completed") {
          await exitRunsForContact(contactId, "booking")
        }
        await applyPipelineEvent({
          contactId,
          event: { kind: "booking", status: data.status, occurredAt: new Date() },
        })
      }
    } catch (err) {
      console.error("[ghl-booking-webhook] sequence/pipeline hook failed", (err as Error).message)
    }
```

Note the deliberate asymmetry: `exitRunsForContact` fires only on
`scheduled|completed` (a cancellation should not end a nurture sequence — that was
fixed in `63ff31db`), but the pipeline **does** care about all four statuses.

In `stripe/webhook/route.ts`, inside the existing `checkout.session.completed` block:

```ts
          if (contactId) {
            await exitRunsForContact(contactId, "payment")
            await applyPipelineEvent({
              contactId,
              event: {
                kind: "payment",
                amountCents: session.amount_total ?? 0,
                currency: session.currency ?? "usd",
                occurredAt: new Date(),
              },
            })
          }
```

- [ ] **Step 3: Mutation**

Make `applyPipelineEvent` throw unconditionally. Expected: the two "does not fail the
webhook" tests still PASS (proving the catch works) while the behavioural tests FAIL.
Record both observations, revert.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/ghl-booking/route.ts app/api/stripe/webhook/route.ts __tests__/api/webhooks/pipeline-hooks.test.ts
git commit -m "feat(lead-engine): a booking and a payment move the card themselves"
```

---

## Task 6: The reconciler

**Files:**
- Create: `lib/automation/pipeline-reconcile.ts`
- Create: `app/api/admin/internal/pipeline-reconcile/route.ts`
- Modify: `lib/cron-catalog.ts`, `app/api/admin/automation/trigger/route.ts`,
  `functions/src/index.ts`, `lib/automation/automation-health-scanner.ts`
- Test: `__tests__/lib/automation/pipeline-reconcile.test.ts`,
  `__tests__/api/admin/internal/pipeline-reconcile.test.ts`

**Interfaces:**
- Produces: `runPipelineReconcile(): Promise<{ createdFromBookings: number; wonFromPayments: number; scanned: number }>`

**Why:** a hook that throws *after* the booking row is written loses a card
permanently, and the only symptom is a deal missing from a board nobody can audit.

- [ ] **Step 1: Write the failing tests**

```ts
describe("runPipelineReconcile", () => {
  it("creates a card for a booking whose contact has no opportunity")
  it("creates nothing on a second pass — idempotent")           // the whole point
  it("wins an open card whose contact has a succeeded payment")
  it("ignores payments that are pending, failed or refunded")
  it("ignores bookings older than the scan window")
  it("does not resurrect a card a human closed")                 // reuses decideMove
  it("reports counts so a non-zero result is visible as a bug signal")
})
```

- [ ] **Step 2: Run (FAIL) → implement → run (PASS)**

`lib/automation/pipeline-reconcile.ts` scans a bounded window (**30 days**, a named
constant) for:
1. `bookings` rows with `status IN ('scheduled','completed')` whose contact resolves
   and has no opportunity → `applyPipelineEvent` with `trigger` recorded as
   `reconciler`.
2. `payments` with `status='succeeded'` whose contact has an **open** opportunity →
   `applyPipelineEvent` with the payment event.

Every write goes through `applyPipelineEvent`, so the reconciler cannot invent a rule
`decideMove` does not already enforce — including the human-close guard. Do not
reimplement movement here.

Idempotency rests on two things: the partial unique index, and matching the source
booking/payment id in `opportunity_stage_events.metadata`.

- [ ] **Step 3: The route**

Copy `app/api/admin/internal/sequence-tick/route.ts` exactly — `INTERNAL_CRON_TOKEN`
bearer check, then:

```ts
  const gate = await isCronSkipped({
    enabledKey: "cron_pipeline_reconcile_enabled",
    defaultEnabled: false,
  })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })
```

Wrap in `logCronStart` / `logCronEnd` so the automation-health watchdog sees failures.

- [ ] **Step 4: Wire the cron in all four places, then assert they agree**

1. `lib/cron-catalog.ts` — add `"pipeline-reconcile"` to `CronJobName` and a
   `CRON_CATALOG` entry (`schedule: "20 * * * *"`, hourly; `firebaseFunction:
   "pipelineReconcileCron"`; `enabledKey: "cron_pipeline_reconcile_enabled"`;
   `defaultEnabled: false`).
2. `app/api/admin/automation/trigger/route.ts` — add to `VERCEL_ROUTE_JOBS`.
3. `functions/src/index.ts` — an `onSchedule` copying `sequenceTickCron` exactly.
4. `lib/automation/automation-health-scanner.ts` — add to the expected-cron list so
   silent failure surfaces.

Then extend the existing agreement test in
`__tests__/api/admin/automation/trigger.test.ts`:

```ts
  it("pipeline-reconcile exists in the catalog and has a Vercel route", () => {
    expect(CRON_CATALOG.find((c) => c.name === "pipeline-reconcile")).toBeTruthy()
    expect(VERCEL_ROUTE_JOBS["pipeline-reconcile"]).toBe("/api/admin/internal/pipeline-reconcile")
  })
```

Stage 1b proved these two lists drift silently and that the "Run now" button 500s when
they do.

- [ ] **Step 5: Mutation**

Remove the `pipeline-reconcile` entry from `VERCEL_ROUTE_JOBS`. Expected: the
agreement test FAILS. Record, revert.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(lead-engine): the board repairs what a dropped webhook lost"
```

---

## Task 7: Campaign-to-revenue

**Files:**
- Create: `lib/automation/campaign-revenue.ts`
- Test: `__tests__/lib/automation/campaign-revenue.test.ts`

**Interfaces:**
- Produces: `readCampaignRevenue(input: { since: Date; until: Date }): Promise<CampaignRevenueRow[]>`
  where `CampaignRevenueRow = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; wonCount: number; wonValueCents: number; unattributedCount: number }`

The join, entirely over columns that exist today:

```
marketing_attribution.session_id
   ← contacts.first_touch_session_id  (copied to opportunities.source_session_id)
   → opportunities WHERE outcome = 'won'
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("readCampaignRevenue", () => {
  it("groups won value by utm_campaign")
  it("reads value from opportunities, not from payments")   // one number, by construction
  it("counts a won deal with no session id as unattributed rather than dropping it")
  it("counts a session id with no attribution row as unattributed")
  it("excludes open and lost deals")
  it("excludes deals closed outside the window")
  it("returns an empty list, not an error, when nothing is won yet")  // launch month
})
```

The unattributed cases matter: a report that silently drops unmatched revenue reads
as "this campaign earned everything" when it earned a fraction. `null` and `0` are
different answers.

- [ ] **Step 2: Run (FAIL) → implement → run (PASS)**

Group in memory after two reads (won opportunities in window, then their attribution
rows by `session_id`). Do not attempt a single Supabase join across
`opportunities` → `contacts` → `marketing_attribution`; the DAL convention here is
explicit reads with checked errors.

- [ ] **Step 3: Mutation**

Make the unattributed bucket drop rows instead of counting them. Expected: both
unattributed tests FAIL. Record, revert.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(lead-engine): won money traced back to the campaign that earned it"
```

---

## Task 8: The board UI

**Files:**
- Create: `app/(admin)/admin/pipeline/page.tsx`, `components/admin/pipeline-board.tsx`,
  `app/api/admin/pipeline/move/route.ts`
- Modify: `__tests__/lib/lead-engine/no-brand-literals.test.ts`
- Test: `__tests__/api/admin/pipeline-move.test.ts`

- [ ] **Step 1: Extend the brand-literal scan FIRST**

Add every file this plan created to the scanned list in
`__tests__/lib/lead-engine/no-brand-literals.test.ts` before writing UI copy, so the
scan is in place while the copy is being written rather than after.

- [ ] **Step 2: The move endpoint**

`POST /api/admin/pipeline/move` — admin-only via `withAudit()`
(`lib/audit/with-audit.ts`), body `{ opportunityId, toStageKey }`, calls
`moveOpportunityManually` with the session user id. Tests: 401 unauthenticated, 403
non-admin, 200 admin, and that a move to a `won`/`lost` stage sets
`closed_trigger='manual'` — the thing that makes it final.

- [ ] **Step 3: The board**

Server component reading `readBoard()`. Columns per stage in position order; cards
show contact name, days in stage, staleness colour, and value on Won. Drag via
`@dnd-kit` (already a dependency). Business name from `business_settings` — never a
literal.

Staleness colours use the existing semantic tokens (`--warning`, `--error`); no
hardcoded hex, per CLAUDE.md.

- [ ] **Step 4: Commit**

---

## Task 9: The campaign-to-revenue surface

**Files:**
- Create: `app/(admin)/admin/insights/campaign-revenue/page.tsx`

- [ ] **Step 1:** Render `readCampaignRevenue` through
  `components/ui/data-table.tsx` — `DataTableCard` → `DataTableToolbar` →
  `DataTable` → `DataTableFooter` with the totals. Never a hand-rolled `<table>`;
  `/admin/team` is the cautionary example in CLAUDE.md.

- [ ] **Step 2:** Show the unattributed bucket as its own row, always — including
  when it is zero. A hidden bucket is how a partial report reads as a complete one.

- [ ] **Step 3:** Add the launch-expectation note to the page: reporting starts at
  launch, there is nothing to back-fill, and the first month is thin by design
  (parent spec §8).

- [ ] **Step 4: Commit**

---

## Final verification (run after Task 9, before review)

```bash
# Targeted — every suite this branch created or touched.
npx vitest run __tests__/lib/lead-engine __tests__/db/pipeline.test.ts \
  __tests__/lib/automation/pipeline-reconcile.test.ts \
  __tests__/lib/automation/campaign-revenue.test.ts \
  __tests__/api/webhooks/pipeline-hooks.test.ts \
  __tests__/api/admin/internal/pipeline-reconcile.test.ts \
  __tests__/api/admin/pipeline-move.test.ts \
  __tests__/api/admin/automation/trigger.test.ts

npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: all suites green; `tsc` **251**. A different number — higher OR lower —
must be explained by diffing normalised error lists against `main`, not waved through.

## Cascade re-review (mandatory, spec §3.5)

```bash
grep -n "REFERENCES public.contacts(id)" supabase/migrations/*.sql
```

**Expect seven lines / six real FKs.** The seventh (`00217:50`) is the instructional
comment, not an FK. For each real hit, confirm it is re-pointed in `merge_contacts`
(now `00220`) or explicitly exempt. An eighth real FK means the merge is wrong until
proven otherwise. Do not delegate this to per-task review — no single task's reviewer
can see the interaction, which is exactly how Stage 1a destroyed consent evidence.

## Self-Review

**Spec coverage:** §2.1 creation → Tasks 3,4,5. §2.2 stages → Tasks 1,3. §2.3 value
→ Tasks 1,3,4. §2.4 human close + re-booking window → Tasks 1,3,4,8. §3.1–3.4 schema
→ Task 1. §3.5 cascade → Task 2 + the mandatory re-review. §4 decideMove → Task 3.
§5 hooks → Task 5. §6 reconciler → Task 6. §7 campaign-to-revenue → Task 7. §7.1
first-touch merge debt → Task 2. §8 staleness → Tasks 3,8. §9 surfaces → Tasks 8,9.
§10 audit slugs → Task 4. §11 testing → every task. No spec section is unimplemented.

**Type consistency:** `StageRow`, `OpportunityState`, `MoveContext`, `PipelineEvent`,
`MoveDecision`, `Staleness` are defined once in Task 3 and consumed unchanged by
Tasks 4–9. `applyPipelineEvent` has one signature across Tasks 4, 5 and 6.
`readBoard`/`BoardColumn`/`BoardCard` are defined in Task 4 and consumed in Task 8.

**Known gap, stated rather than hidden:** the spec's §13 open questions — refund
handling and the 30-day window — are NOT implemented as configurable. The window is
`REBOOKING_SUPPRESSION_DAYS`, a single exported constant, so confirming or changing
it is a one-line edit. Refunds are out of scope for this plan: `payments.status`
can become `refunded`, which would leave a Won card overstating revenue. No task
handles it, deliberately, because the spec has not settled the behaviour.
