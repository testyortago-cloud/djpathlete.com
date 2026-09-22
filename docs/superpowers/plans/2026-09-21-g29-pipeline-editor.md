# G29 — Board Editor and Hand-Made Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach can reshape any pipeline board's stages from a screen, create and archive boards, and put a person on a board by hand — without a migration and without sending anyone an email.

**Architecture:** Per-operation routes for boards (independent objects); ONE whole-list atomic save for a board's stage list (only valid as a whole), mirroring `save_sequence_steps` from migration `00256`. The hand-made card reaches the contact spine through the two non-enrolling helpers, never through `recordContactEvent`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase/Postgres, Vitest, Zod, shadcn/ui, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-21-g29-pipeline-editor-design.md` — read it before Task 1. Every task below argues from it.

## Global Constraints

- **Branch:** `worktree-g29-pipeline-editor`, based on `main` @ `7727bc70`. Never push, never merge, never apply a migration to production, never run a script against `.env.prod`.
- **Never add `Co-Authored-By` or any Claude attribution** to a commit. Check `git log` after every commit.
- **Migration number:** `00276` is free as of 2026-09-21 18:00 UTC. **Four peer Claude sessions are running against this repo.** Re-check with `git ls-tree --name-only main supabase/migrations/ | tail -1` immediately before committing Task 2, and check every worktree under `.claude/worktrees/`.
- **Apply migrations to the DEV clone automatically** (standing instruction), never production. `.env.local` points at the dev clone.
- **tsc baseline:** exactly **238 errors across 54 files**, per-file set identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt`. A falling count hides new errors too — compare the set, not just the number.
- **Pre-existing RED suites** — do not blame these on your work. Corrected 2026-09-22 (R8): main is **13 failures across 4 files**, not 7 across 3. `__tests__/migrations/00062.test.ts` (3, needs a live DB), `__tests__/lib/coach-reachability.test.ts` (1), `__tests__/components/admin/funnel-builder-initial-prompt.test.tsx` (3), and `__tests__/lib/ai/tool-loop.test.ts` (6, broken by the OpenRouter migration — fixture model id "m" has no slug). NOT G29 work.
- **Run the WHOLE suite before calling a task done.** A suite selection has hidden a red test three times in this ledger's history.
- **Stage `position` starts at 1**, not 0, on all three seeded boards.
- **Tables use `components/ui/data-table.tsx`.** Never hand-roll a `<table>`.
- **Admin UI is light-only.** `.dark` is a class variant the admin never sets.
- Colors are semantic classes (`text-primary`, `bg-accent`), never hardcoded hex.

---

### Task 1: The pure stage-list module

**Files:**
- Create: `lib/lead-engine/stage-list.ts`
- Test: `__tests__/lib/lead-engine/stage-list.test.ts`

**Interfaces:**
- Consumes: nothing. This task is pure TypeScript with no imports from `lib/db`.
- Produces:
  - `type StageDraft = { id: string | null; key: string; name: string; kind: "open" | "won" | "lost"; amberAfterDays: number | null; redAfterDays: number | null }`
  - `type StageProblem = { index: number | null; message: string }`
  - `type SavedStage = { id: string; key: string; position: number }`
  - `type StageSavePlan = { moveCards: Array<{ fromStageId: string; toStageId: string }>; removedStageIds: string[]; keptStageIds: string[] }`
  - `function validateStageList(stages: StageDraft[]): StageProblem[]`
  - `function planStageSave(oldStages: SavedStage[], newStages: StageDraft[], cardCountByStageId: Map<string, number>, destinationByRemovedStageId: Map<string, string>): StageSavePlan`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/lead-engine/stage-list.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { planStageSave, validateStageList, type StageDraft, type SavedStage } from "@/lib/lead-engine/stage-list"

const open = (key: string, name = key): StageDraft => ({
  id: null, key, name, kind: "open", amberAfterDays: 3, redAfterDays: 7,
})
const won = (): StageDraft => ({ id: null, key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null })
const lost = (): StageDraft => ({ id: null, key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null })

describe("validateStageList", () => {
  it("accepts a board with one won, one lost and at least one open stage", () => {
    expect(validateStageList([open("enquiry"), won(), lost()])).toEqual([])
  })

  it("refuses an empty list", () => {
    expect(validateStageList([])).toEqual([{ index: null, message: "A board needs at least one stage." }])
  })

  it("refuses a board with no won stage", () => {
    const problems = validateStageList([open("enquiry"), lost()])
    expect(problems).toContainEqual({ index: null, message: "A board needs exactly one Won stage. This one has 0." })
  })

  it("refuses a board with two lost stages", () => {
    const problems = validateStageList([open("enquiry"), won(), lost(), { ...lost(), key: "lost_2" }])
    expect(problems).toContainEqual({ index: null, message: "A board needs exactly one Lost stage. This one has 2." })
  })

  it("refuses amber later than red, naming the stage index", () => {
    const problems = validateStageList([{ ...open("enquiry"), amberAfterDays: 10, redAfterDays: 3 }, won(), lost()])
    expect(problems).toContainEqual({
      index: 0,
      message: 'Stage "enquiry": the amber warning (10 days) cannot come after the red one (3 days).',
    })
  })

  it("refuses two stages sharing a key", () => {
    const problems = validateStageList([open("enquiry"), open("enquiry"), won(), lost()])
    expect(problems).toContainEqual({ index: 1, message: 'Two stages share the key "enquiry". Keys must be unique on a board.' })
  })

  it("refuses a blank name", () => {
    const problems = validateStageList([{ ...open("enquiry"), name: "  " }, won(), lost()])
    expect(problems).toContainEqual({ index: 0, message: "Every stage needs a name." })
  })

  it("allows amber or red to be absent", () => {
    expect(validateStageList([{ ...open("enquiry"), amberAfterDays: null, redAfterDays: null }, won(), lost()])).toEqual([])
  })
})

describe("planStageSave", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1 },
    { id: "s2", key: "booked", position: 2 },
    { id: "s3", key: "won", position: 3 },
    { id: "s4", key: "lost", position: 4 },
  ]

  it("keeps every stage when the list is only reordered", () => {
    const next: StageDraft[] = [
      { ...open("booked"), id: "s2" }, { ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" },
    ]
    const plan = planStageSave(oldStages, next, new Map(), new Map())
    expect(plan.removedStageIds).toEqual([])
    expect(plan.moveCards).toEqual([])
    expect(plan.keptStageIds.sort()).toEqual(["s1", "s2", "s3", "s4"])
  })

  it("removes a stage that holds no cards without moving anything", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 0]]), new Map())
    expect(plan.removedStageIds).toEqual(["s2"])
    expect(plan.moveCards).toEqual([])
  })

  it("moves the cards off a removed stage to its named destination", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 4]]), new Map([["s2", "s1"]]))
    expect(plan.removedStageIds).toEqual(["s2"])
    expect(plan.moveCards).toEqual([{ fromStageId: "s2", toStageId: "s1" }])
  })

  it("treats a stage with cards and no destination as a plan with no move — the caller refuses it", () => {
    const next: StageDraft[] = [{ ...open("enquiry"), id: "s1" }, { ...won(), id: "s3" }, { ...lost(), id: "s4" }]
    const plan = planStageSave(oldStages, next, new Map([["s2", 4]]), new Map())
    expect(plan.moveCards).toEqual([])
    expect(plan.removedStageIds).toEqual(["s2"])
  })

  it("never lists a brand-new stage as kept — it has no id yet", () => {
    const next: StageDraft[] = [
      { ...open("enquiry"), id: "s1" }, open("nurturing"), { ...won(), id: "s3" }, { ...lost(), id: "s4" },
    ]
    const plan = planStageSave(oldStages, next, new Map([["s2", 0]]), new Map())
    expect(plan.keptStageIds).not.toContain(null)
    expect(plan.keptStageIds.sort()).toEqual(["s1", "s3", "s4"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/lead-engine/stage-list.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/lead-engine/stage-list"`.

- [ ] **Step 3: Write the module**

Create `lib/lead-engine/stage-list.ts`. Mirror the shape and comment discipline of `lib/lead-engine/step-list.ts` — read that file first.

```ts
// lib/lead-engine/stage-list.ts — the rules a board's stage list must satisfy,
// and what an edit does to the cards already sitting on it.
//
// Pure on purpose, exactly like its sibling `step-list.ts`: the SQL function
// `save_pipeline_stages` (migration 00276) WRITES, this DECIDES. Keeping the
// rules here means they cannot drift into a second home in plpgsql where the
// route's copy and the database's copy slowly disagree.

export type StageKind = "open" | "won" | "lost"

export type StageDraft = {
  /** null means a stage that does not exist yet. */
  id: string | null
  key: string
  name: string
  kind: StageKind
  amberAfterDays: number | null
  redAfterDays: number | null
}

export type StageProblem = { index: number | null; message: string }

/**
 * Every problem with a stage list, in the order a person would read them.
 *
 * Returns [] for a valid list. `index` is the position in the submitted array
 * for a problem with one stage, and null for a problem with the board as a
 * whole -- the editor puts the first against a field and the second at the top.
 */
export function validateStageList(stages: StageDraft[]): StageProblem[] {
  const problems: StageProblem[] = []

  if (stages.length === 0) {
    return [{ index: null, message: "A board needs at least one stage." }]
  }

  const seenKeys = new Map<string, number>()
  stages.forEach((stage, index) => {
    if (stage.name.trim().length === 0) {
      problems.push({ index, message: "Every stage needs a name." })
    }
    if (stage.key.trim().length === 0) {
      problems.push({ index, message: "Every stage needs a key." })
    } else if (seenKeys.has(stage.key)) {
      problems.push({
        index,
        message: `Two stages share the key "${stage.key}". Keys must be unique on a board.`,
      })
    } else {
      seenKeys.set(stage.key, index)
    }

    // Both present, or the comparison is meaningless. The CHECK constraint on
    // pipeline_stages says the same thing; this exists so the refusal arrives
    // as English before the write rather than as a Postgres error after it.
    if (stage.amberAfterDays !== null && stage.redAfterDays !== null && stage.amberAfterDays > stage.redAfterDays) {
      problems.push({
        index,
        message: `Stage "${stage.key}": the amber warning (${stage.amberAfterDays} days) cannot come after the red one (${stage.redAfterDays} days).`,
      })
    }
  })

  // The two rules SQL cannot state. `decideMove` requires BOTH a won and a
  // lost stage to exist; a board missing either cannot close a card at all,
  // and a board with two of either cannot say which one closing means.
  for (const kind of ["won", "lost"] as const) {
    const count = stages.filter((s) => s.kind === kind).length
    if (count !== 1) {
      const label = kind === "won" ? "Won" : "Lost"
      problems.push({ index: null, message: `A board needs exactly one ${label} stage. This one has ${count}.` })
    }
  }

  return problems
}

export type SavedStage = { id: string; key: string; position: number }
export type StageSavePlan = {
  /** Cards on a removed stage, and where they were told to go. */
  moveCards: Array<{ fromStageId: string; toStageId: string }>
  removedStageIds: string[]
  keptStageIds: string[]
}

/**
 * What an edit does to the cards already on the board.
 *
 * Matched on STAGE ID, never key or position -- ids survive a renumber and
 * positions are exactly what a renumber changes.
 *
 * A stage being removed that still holds cards needs somewhere for them to go.
 * This function REPORTS that ( `removedStageIds` without a matching `moveCards`
 * entry ); it does not decide whether that is allowed. The caller refuses,
 * because the caller is the one that can say it in English.
 */
export function planStageSave(
  oldStages: SavedStage[],
  newStages: StageDraft[],
  cardCountByStageId: Map<string, number>,
  destinationByRemovedStageId: Map<string, string>,
): StageSavePlan {
  const submittedIds = new Set<string>()
  for (const stage of newStages) {
    if (stage.id !== null) submittedIds.add(stage.id)
  }

  const plan: StageSavePlan = { moveCards: [], removedStageIds: [], keptStageIds: [] }

  for (const old of oldStages) {
    if (submittedIds.has(old.id)) {
      plan.keptStageIds.push(old.id)
      continue
    }
    plan.removedStageIds.push(old.id)
    const cards = cardCountByStageId.get(old.id) ?? 0
    const destination = destinationByRemovedStageId.get(old.id)
    if (cards > 0 && destination !== undefined) {
      plan.moveCards.push({ fromStageId: old.id, toStageId: destination })
    }
  }

  return plan
}

/**
 * The stages a removal would strand, in English. [] means the save is safe.
 *
 * Separate from `planStageSave` so the route can ask the question without
 * building a plan, and so the message lives beside the other messages.
 */
export function strandedStageProblems(
  oldStages: SavedStage[],
  plan: StageSavePlan,
  cardCountByStageId: Map<string, number>,
): StageProblem[] {
  const keyOf = new Map(oldStages.map((s) => [s.id, s.key]))
  const moved = new Set(plan.moveCards.map((m) => m.fromStageId))
  return plan.removedStageIds
    .filter((id) => (cardCountByStageId.get(id) ?? 0) > 0 && !moved.has(id))
    .map((id) => ({
      index: null,
      message: `Stage "${keyOf.get(id) ?? id}" still has ${cardCountByStageId.get(id)} card(s) on it. Say which stage they should move to before removing it.`,
    }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/lead-engine/stage-list.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Add a test for `strandedStageProblems`**

Append to the test file:

```ts
import { strandedStageProblems } from "@/lib/lead-engine/stage-list"

describe("strandedStageProblems", () => {
  const oldStages: SavedStage[] = [
    { id: "s1", key: "enquiry", position: 1 },
    { id: "s2", key: "booked", position: 2 },
  ]

  it("names the stage and the number of cards when nothing was moved", () => {
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 4]]))).toEqual([
      { index: null, message: 'Stage "booked" still has 4 card(s) on it. Say which stage they should move to before removing it.' },
    ])
  })

  it("is silent when the cards were given a destination", () => {
    const plan = { moveCards: [{ fromStageId: "s2", toStageId: "s1" }], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 4]]))).toEqual([])
  })

  it("is silent when the removed stage was empty", () => {
    const plan = { moveCards: [], removedStageIds: ["s2"], keptStageIds: ["s1"] }
    expect(strandedStageProblems(oldStages, plan, new Map([["s2", 0]]))).toEqual([])
  })
})
```

Run: `npx vitest run __tests__/lib/lead-engine/stage-list.test.ts` — Expected: PASS, 17 tests.

- [ ] **Step 6: Mutate every guard and confirm each test fails**

For each mutation, make the edit, run the suite, confirm a FAILURE naming the right test, then revert. Record the result in the commit message.

| # | Mutation in `stage-list.ts` | Test that must fail |
|---|---|---|
| 1 | `count !== 1` → `count < 1` | "refuses a board with two lost stages" |
| 2 | `amberAfterDays > redAfterDays` → `>=` | "accepts a board with one won, one lost…" |
| 3 | drop the `seenKeys.has` branch | "refuses two stages sharing a key" |
| 4 | `stage.id !== null` → `true` in `planStageSave` | "never lists a brand-new stage as kept" |
| 5 | `cards > 0 &&` removed | "removes a stage that holds no cards…" |
| 6 | `!moved.has(id)` removed from `strandedStageProblems` | "is silent when the cards were given a destination" |

**Run the mutation, do not trust the reasoning.** A mutant you argue is killed and never ran is not killed.

- [ ] **Step 7: Commit**

```bash
git add lib/lead-engine/stage-list.ts __tests__/lib/lead-engine/stage-list.test.ts
git commit
```

Message: `feat(pipeline): the rules a board's stage list must satisfy (G29)` — body records the 6/6 mutation sweep and why the module is pure.

---

### Task 2: Migration 00276 — `save_pipeline_stages`

**Files:**
- Create: `supabase/migrations/00276_save_pipeline_stages.sql`
- Test: `__tests__/migrations/00276.test.ts`

**Interfaces:**
- Consumes: Task 1's `StageSavePlan` shape, passed in as JSON.
- Produces: `save_pipeline_stages(p_business_id uuid, p_pipeline_id uuid, p_stages jsonb, p_move_cards jsonb) RETURNS void`

- [ ] **Step 1: Re-check the migration number**

```bash
git ls-tree --name-only main supabase/migrations/ | tail -1
ls ../*/supabase/migrations/ | tail -5
```

Expected: `00275_revoke_anon_security_definer_rpcs.sql` is main's highest, so `00276` is free. **If anything higher exists in any worktree, renumber now** — renumbering is free only before the push.

- [ ] **Step 2: Write the failing test**

Create `__tests__/migrations/00276.test.ts`. Follow the shape of an existing live-DB migration test — read `__tests__/migrations/00062.test.ts` for the client setup. It runs against the dev clone via `.env.local`.

```ts
import { beforeAll, describe, expect, it } from "vitest"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Live dev-clone test. Skipped when the env is absent so a laptop with no
// .env.local does not report a false failure.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const describeIf = url && key ? describe : describe.skip

describeIf("save_pipeline_stages (00276)", () => {
  let db: SupabaseClient
  let pipelineId: string
  let businessId: string

  beforeAll(async () => {
    db = createClient(url!, key!)
    const { data } = await db.from("pipelines").select("id, business_id").eq("key", "coaching").single()
    pipelineId = data!.id
    businessId = data!.business_id
  })

  it("renumbers the whole board from the submitted order, which a pairwise swap could not", async () => {
    const { data: before } = await db
      .from("pipeline_stages").select("id, key, position").eq("pipeline_id", pipelineId).order("position")

    const reversed = [...before!].reverse().map((s, i) => ({
      id: s.id, key: s.key, name: s.key, kind: null, amber_after_days: null, red_after_days: null, position: i + 1,
    }))
    // kind must be preserved; read it rather than inventing it.
    const { data: kinds } = await db.from("pipeline_stages").select("id, kind, name").eq("pipeline_id", pipelineId)
    const kindOf = new Map(kinds!.map((k) => [k.id, k]))
    for (const s of reversed) {
      s.kind = kindOf.get(s.id)!.kind
      s.name = kindOf.get(s.id)!.name
    }

    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: reversed, p_move_cards: [],
    })
    expect(error).toBeNull()

    const { data: after } = await db
      .from("pipeline_stages").select("id, position").eq("pipeline_id", pipelineId).order("position")
    expect(after!.map((s) => s.id)).toEqual(reversed.map((s) => s.id))

    // Put it back, so the shared dev clone is left as it was found.
    const restored = before!.map((s, i) => ({
      id: s.id, key: s.key, name: kindOf.get(s.id)!.name, kind: kindOf.get(s.id)!.kind,
      amber_after_days: null, red_after_days: null, position: i + 1,
    }))
    await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: restored, p_move_cards: [],
    })
  })

  it("RAISEs when a submitted stage id does not belong to this board", async () => {
    const { data: stages } = await db.from("pipeline_stages").select("id, key, name, kind").eq("pipeline_id", pipelineId)
    const foreign = [
      ...stages!.map((s, i) => ({ ...s, amber_after_days: null, red_after_days: null, position: i + 1 })),
      { id: "00000000-0000-0000-0000-0000000000ff", key: "ghost", name: "Ghost", kind: "open",
        amber_after_days: null, red_after_days: null, position: stages!.length + 1 },
    ]
    const { error } = await db.rpc("save_pipeline_stages", {
      p_business_id: businessId, p_pipeline_id: pipelineId, p_stages: foreign, p_move_cards: [],
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/does not belong to this board/i)
  })

  it("leaves the board untouched when it raises", async () => {
    const { data: after } = await db.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId)
    expect(after!.length).toBe(4)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run __tests__/migrations/00276.test.ts`
Expected: FAIL — `Could not find the function public.save_pipeline_stages`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/00276_save_pipeline_stages.sql`:

```sql
-- 00276_save_pipeline_stages.sql
--
-- G29. Replaces a board's whole stage list atomically.
--
-- TypeScript decides, this writes. Validation and the card-move plan are
-- computed by lib/lead-engine/stage-list.ts and passed in; the business rules
-- do not get a second home here where they can drift from the editor's copy.
-- This mirrors save_sequence_steps (00256) deliberately, including its
-- survivor row-count check -- see below for why that is not optional.
--
-- WHY WHOLE-LIST AND NOT PER-STAGE: pipeline_stages carries
-- UNIQUE (pipeline_id, position) and it is NOT deferrable, so two stages
-- cannot be swapped with two UPDATEs -- the first collides with the row that
-- has not moved yet. Renumbering the entire board from the submitted order in
-- one statement sidesteps that completely, needs no DEFERRABLE migration, and
-- fails atomically.

CREATE OR REPLACE FUNCTION public.save_pipeline_stages(
  p_business_id uuid,
  p_pipeline_id uuid,
  p_stages     jsonb,   -- ordered array; ARRAY ORDER IS THE POSITION
  p_move_cards jsonb    -- [{ "from_stage_id": uuid, "to_stage_id": uuid }]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_submitted_ids uuid[];
  v_survivors     integer;
  v_expected      integer;
BEGIN
  -- The board must belong to the tenant. Every other statement here is
  -- scoped by p_pipeline_id, so this is the one line standing between a
  -- caller with the wrong business_id and another tenant's board.
  PERFORM 1 FROM public.pipelines
   WHERE id = p_pipeline_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Board % does not belong to business %', p_pipeline_id, p_business_id;
  END IF;

  SELECT array_agg((s->>'id')::uuid)
    INTO v_submitted_ids
    FROM jsonb_array_elements(p_stages) s
   WHERE s->>'id' IS NOT NULL;

  -- SURVIVOR CHECK. A submitted id that does not belong to this board
  -- (stale, another board's, or just wrong -- reachable with nothing more
  -- exotic than one coach with two tabs open) would match no row in the
  -- UPDATE below while every later array slot still took its own position,
  -- punching a gap in the ordering. save_sequence_steps carries the same
  -- check for the same reason; its header explains the incident.
  IF v_submitted_ids IS NOT NULL THEN
    v_expected := array_length(v_submitted_ids, 1);
    SELECT count(*) INTO v_survivors
      FROM public.pipeline_stages
     WHERE pipeline_id = p_pipeline_id
       AND id = ANY(v_submitted_ids);
    IF v_survivors <> v_expected THEN
      RAISE EXCEPTION 'A submitted stage does not belong to this board (% of % matched)', v_survivors, v_expected;
    END IF;
  END IF;

  -- 1. Move the cards off any stage that is about to disappear. BEFORE the
  --    delete, or the FK on opportunities.stage_id refuses it.
  UPDATE public.opportunities o
     SET stage_id         = (m->>'to_stage_id')::uuid,
         entered_stage_at = now(),
         updated_at       = now()
    FROM jsonb_array_elements(p_move_cards) m
   WHERE o.stage_id = (m->>'from_stage_id')::uuid
     AND o.business_id = p_business_id;

  -- 2. Remove the stages that are gone. A stage still holding a card fails
  --    here on the FK, which is the correct last line: the route refuses it
  --    in English first, and this is what happens if that check is bypassed.
  DELETE FROM public.pipeline_stages
   WHERE pipeline_id = p_pipeline_id
     AND (v_submitted_ids IS NULL OR NOT (id = ANY(v_submitted_ids)));

  -- 3. Park every survivor at a negative position. The unique index is on
  --    (pipeline_id, position) and is not deferrable, so the final positions
  --    cannot be written while the old ones are still occupied. Negatives are
  --    outside the range step 4 writes, so the two sets cannot collide.
  UPDATE public.pipeline_stages
     SET position = -position
   WHERE pipeline_id = p_pipeline_id;

  -- 4. Update the survivors in place and renumber from the submitted order.
  --    `key` is deliberately NOT in the SET list: it is immutable once
  --    created, because every stored opportunity_stage_events row and
  --    routeToPipeline's return value reference it.
  UPDATE public.pipeline_stages st
     SET name             = s.name,
         kind             = s.kind,
         amber_after_days = s.amber_after_days,
         red_after_days   = s.red_after_days,
         position         = s.position
    FROM (
      SELECT (e.value->>'id')::uuid              AS id,
             e.value->>'name'                    AS name,
             e.value->>'kind'                    AS kind,
             (e.value->>'amber_after_days')::int AS amber_after_days,
             (e.value->>'red_after_days')::int   AS red_after_days,
             e.ordinality::int                   AS position
        FROM jsonb_array_elements(p_stages) WITH ORDINALITY e
       WHERE e.value->>'id' IS NOT NULL
    ) s
   WHERE st.id = s.id
     AND st.pipeline_id = p_pipeline_id;

  -- 5. Insert the brand-new stages at their submitted positions.
  INSERT INTO public.pipeline_stages
    (business_id, pipeline_id, key, name, position, kind, amber_after_days, red_after_days)
  SELECT p_business_id,
         p_pipeline_id,
         e.value->>'key',
         e.value->>'name',
         e.ordinality::int,
         e.value->>'kind',
         (e.value->>'amber_after_days')::int,
         (e.value->>'red_after_days')::int
    FROM jsonb_array_elements(p_stages) WITH ORDINALITY e
   WHERE e.value->>'id' IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_pipeline_stages(uuid, uuid, jsonb, jsonb) TO service_role;
```

**The REVOKE is not decoration.** Migration `00275` closed five SECURITY DEFINER functions that `anon` could call over `/rest/v1/rpc/`. A new function granted to `PUBLIC` by default would reopen exactly that hole. Note `=X/postgres` in `proacl` means PUBLIC — revoking only `anon` is a no-op that reads like a fix.

- [ ] **Step 5: Apply to the dev clone and read it back**

Apply via the Supabase MCP (dev project, never prod). Then confirm:

```sql
select proname, pg_get_function_identity_arguments(oid), proacl
  from pg_proc where proname = 'save_pipeline_stages';
```

Expected: one row; `proacl` shows `service_role=X/postgres` and **no** `=X/` PUBLIC entry.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run __tests__/migrations/00276.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Mutate the SQL**

| # | Mutation | Test that must fail |
|---|---|---|
| 1 | Delete the survivor-check `IF` block | "RAISEs when a submitted stage id does not belong" |
| 2 | Delete step 3 (the negative parking `UPDATE`) | "renumbers the whole board from the submitted order" (unique violation) |
| 3 | Add `key = s.key` to step 4's `SET` | add a test asserting key is unchanged after a rename, then this fails |
| 4 | Drop `AND business_id = p_business_id` from the ownership `PERFORM` | add a wrong-tenant test, then this fails |

Mutations 3 and 4 require writing the two extra tests first. Write them.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00276_save_pipeline_stages.sql __tests__/migrations/00276.test.ts
git commit
```

Message: `feat(pipeline): one atomic whole-list save for a board's stages (G29)` — the body must explain the negative-parking step and the survivor check, and record the mutation results.

---

### Task 3: DAL — board CRUD and `savePipelineStages`

**Files:**
- Modify: `lib/db/pipeline.ts` (append; it is already 2055 lines — do not restructure it in this task)
- Test: `__tests__/db/pipeline-boards.test.ts`

**Interfaces:**
- Consumes: Task 1's `StageDraft`, `validateStageList`, `planStageSave`, `strandedStageProblems`; Task 2's `save_pipeline_stages` RPC.
- Produces:
  - `createPipelineBoard(input: { name: string; businessId: string }): Promise<{ id: string; key: string }>`
  - `updatePipelineBoard(input: { pipelineId: string; businessId: string; name?: string; status?: "active" | "archived" }): Promise<void>`
  - `readStagesForEdit(pipelineId: string, businessId: string): Promise<{ stages: SavedStage[]; cardCountByStageId: Map<string, number> }>`
  - `savePipelineStages(input: { pipelineId: string; businessId: string; stages: StageDraft[]; destinations: Record<string, string> }): Promise<{ ok: true } | { ok: false; problems: StageProblem[] }>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/db/pipeline-boards.test.ts`. Mock the Supabase client the way the existing `__tests__/db/pipeline.test.ts` does — read it first and match its fake. **The fake must be projection-aware**: a fake that ignores `.select()` columns cannot catch a wrong-column read, which has bitten this repo three times.

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"

// Assert the SLUG, not that something was written.
describe("createPipelineBoard", () => {
  it("slugifies the name into a key", async () => {
    // "Camps & Clinics" -> "camps_clinics"
  })
  it("refuses a name that slugifies to a key this tenant already has", async () => {})
  it("seeds the new board with a won and a lost stage, so it is valid the moment it exists", async () => {})
})

describe("updatePipelineBoard", () => {
  it("refuses to archive the board DEFAULT_PIPELINE_KEY names", async () => {})
  it("archives any other board", async () => {})
  it("scopes the update by business_id", async () => {})
})

describe("savePipelineStages", () => {
  it("returns the validator's problems without calling the RPC when the list is invalid", async () => {})
  it("refuses a removal that would strand cards, naming the stage", async () => {})
  it("calls save_pipeline_stages with the ordered array when the list is valid", async () => {})
})
```

Fill each `it` with a real body following the existing suite's fake. The empty bodies above are a **map, not the test** — a test with no assertions passes and proves nothing.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/db/pipeline-boards.test.ts`
Expected: FAIL — the functions do not exist.

- [ ] **Step 3: Implement in `lib/db/pipeline.ts`**

Key points the implementer must not get wrong:

```ts
/**
 * G29. A new board is created VALID: it gets a won and a lost stage
 * immediately, because `validateStageList` (and `decideMove`) require both and
 * a board that exists for even one request without them is a board whose cards
 * cannot be closed.
 */
export async function createPipelineBoard(input: { name: string; businessId: string }) {
  const key = slugifyBoardKey(input.name)
  // ... insert pipelines row, then the two stages at positions 1 and 2:
  //   { key: "won",  name: "Won",  kind: "won",  position: 1 }
  //   { key: "lost", name: "Lost", kind: "lost", position: 2 }
  // A 23505 on pipelines_key_per_business becomes a readable refusal.
}

export async function updatePipelineBoard(input: {
  pipelineId: string; businessId: string; name?: string; status?: "active" | "archived"
}) {
  // INVARIANT 6. routeToPipeline returns KEYS and a routed event naming an
  // archived board has nowhere to land -- the read path falls back to
  // boards[0], the write path has no such fallback. Refuse the archive.
  if (input.status === "archived") {
    const board = await readBoardRow(input.pipelineId, input.businessId)
    if (board.key === DEFAULT_PIPELINE_KEY) {
      throw new Error(
        `"${board.name}" is the board every unrouted event falls back to, so it cannot be archived. Point the default at another board first.`,
      )
    }
  }
  // ... update, always scoped .eq("business_id", input.businessId)
}
```

`slugifyBoardKey`: lowercase, non-alphanumerics to `_`, collapse repeats, trim leading/trailing `_`, cap at 40 chars. `"Camps & Clinics"` → `camps_clinics`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/db/pipeline-boards.test.ts` — Expected: PASS.

- [ ] **Step 5: Mutate**

At minimum: drop each `.eq("business_id", …)` in turn (a wrong-tenant test must fail — an argument-blind mock tolerates a missing predicate, so assert the filter was applied); invert the `DEFAULT_PIPELINE_KEY` check; make `savePipelineStages` call the RPC even when problems exist.

- [ ] **Step 6: Run the whole suite, then commit**

```bash
npx vitest run
git add lib/db/pipeline.ts __tests__/db/pipeline-boards.test.ts
git commit
```

---

### Task 4: Board routes

**Files:**
- Create: `app/api/admin/pipeline/boards/route.ts`, `app/api/admin/pipeline/boards/[id]/route.ts`
- Modify: `lib/audit/actions.ts`
- Test: `__tests__/app/api/admin/pipeline/boards-route.test.ts`

**Interfaces:**
- Consumes: Task 3's `createPipelineBoard`, `updatePipelineBoard`.
- Produces: `POST /api/admin/pipeline/boards`, `PATCH /api/admin/pipeline/boards/[id]`.

- [ ] **Step 1: Add the audit slugs**

In `lib/audit/actions.ts`, beside the existing `pipeline.*` entries (line ~209):

```ts
{ slug: "pipeline.board_created", category: "admin_write", description: "Pipeline board created" },
{ slug: "pipeline.board_updated", category: "admin_write", description: "Pipeline board renamed or archived" },
{ slug: "pipeline.stages_saved", category: "admin_write", description: "Pipeline board's stage list replaced" },
{ slug: "pipeline.opportunity_created_manually", category: "admin_write", description: "Pipeline card created by hand" },
```

**One save is one audit row.** The 2026-09-01 design proposed five stage slugs; the stage save is one atomic act, so five slugs would describe a transaction that does not exist.

- [ ] **Step 2: Write the failing route test**

Mirror `__tests__/app/api/admin/pipeline/` conventions if any exist; otherwise follow another admin route suite. **Pin the node env** on route suites (`// @vitest-environment node`) — three GHL webhook suites needed exactly this.

Cases, each one required:
1. no session → **401**
2. session without the `contacts` permission → **403**
3. `POST` with a blank name → **400** naming the field
4. `POST` with a duplicate name → **400**, readable
5. `POST` valid → **200**, and `createPipelineBoard` called with the resolved tenant's `businessId`
6. `PATCH` archiving the default board → **400** with the "every unrouted event falls back to" message
7. `PATCH` renaming → **200**

- [ ] **Step 3: Run to verify it fails** — `npx vitest run __tests__/app/api/admin/pipeline/boards-route.test.ts`

- [ ] **Step 4: Write the routes**

Copy the exact shape of `app/api/admin/pipeline/move/route.ts` — `withAudit` wrapper, `auth()`, `canAccessAdminPath`, `resolveAdminTenantForRequest` with the `NoAccessibleBusinessError` → 403 branch, then `request.clone().json()`. **The `target` callback reads the ORIGINAL request; the handler reads a CLONE.** Getting that backwards makes the audit target silently undefined.

- [ ] **Step 5: Run to verify it passes**

- [ ] **Step 6: Mutate** — remove the 403 branch; remove `businessId` from the DAL call; swap `request` and `request.clone()`. Each must fail a test.

- [ ] **Step 7: Run the whole suite, then commit**

---

### Task 5: The stages route

**Files:**
- Create: `app/api/admin/pipeline/boards/[id]/stages/route.ts`
- Test: `__tests__/app/api/admin/pipeline/stages-route.test.ts`

**Interfaces:**
- Consumes: Task 3's `savePipelineStages`, `readStagesForEdit`.
- Produces: `PUT /api/admin/pipeline/boards/[id]/stages`, body `{ stages: StageDraft[]; destinations?: Record<string, string> }`.

- [ ] **Step 1: Write the failing test**

Cases: 401; 403; a body that is not an array → 400; a list with no `won` stage → 400 carrying the validator's exact English; a removal stranding cards → 400 naming the stage; a valid save → 200 and the RPC called with the array in submitted order; a save for a board belonging to another tenant → 403/404, never a write.

Validate the body with Zod. **A `.max()` on a prose field rejects the whole payload** — cap `name` at a length the editor also enforces, and return the field name.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Write the route** — same template as Task 4.
- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Mutate** — return 200 on validator problems; drop the tenant scope; pass the array unsorted.
- [ ] **Step 6: Run the whole suite, then commit**

---

### Task 6: The hand-made card

**Files:**
- Modify: `lib/db/contacts.ts` (union + `IS_PURCHASE_SOURCE`), `lib/lead-engine/enroll.ts` (`IS_SUPERSEDING_SOURCE`), `lib/db/pipeline.ts`
- Create: `app/api/admin/pipeline/opportunities/route.ts`
- Test: `__tests__/app/api/admin/pipeline/opportunities-route.test.ts`

**Interfaces:**
- Consumes: `upsertContactIdentity`, `recordEventForExistingContact` from `lib/db/contacts.ts`.
- Produces: `createOpportunityManually(input: { businessId: string; pipelineId: string; contactId?: string; person?: { name: string; email?: string; phone?: string }; valueCents?: number; actorUserId: string }): Promise<{ opportunityId: string; contactId: string }>`; `POST /api/admin/pipeline/opportunities`.

- [ ] **Step 1: Widen `ContactEventSource`**

In `lib/db/contacts.ts`, add to the union with a comment saying why:

```ts
  /**
   * G29. A card a coach made by hand -- a phone call, a DM, somebody met at a
   * camp. This is history being FILED, not a lead ARRIVING, which is why the
   * two callers use `upsertContactIdentity` / `recordEventForExistingContact`
   * and never `recordContactEvent`: enrolment lives inside the latter, and a
   * hand-made card must never send anybody an email.
   */
  | "manual_card"
```

tsc will now fail on both exhaustive maps. Set **both to `false`**:
- `IS_PURCHASE_SOURCE` — a hand-made card is not a purchase.
- `IS_SUPERSEDING_SOURCE` — it must never exit somebody's active sequence run.

- [ ] **Step 2: Write the failing test, WITH its presence control**

```ts
// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const enrollIfTriggered = vi.fn()
vi.mock("@/lib/lead-engine/enroll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-engine/enroll")>()),
  enrollIfTriggered,
}))

describe("POST /api/admin/pipeline/opportunities", () => {
  beforeEach(() => { enrollIfTriggered.mockClear() })

  it("enrols nobody when a card is made by hand", async () => {
    await POST(requestFor({ pipelineId: BOARD, person: { name: "Dana Reyes", email: "dana@example.com" } }))
    expect(enrollIfTriggered).not.toHaveBeenCalled()
  })

  // THE PRESENCE CONTROL. Without this, the assertion above passes just as
  // well when the mock is wired to the wrong path, the import is stale, or the
  // test never reached the code at all. This proves the spy CAN fire.
  it("control: the same fixture through recordContactEvent DOES enrol", async () => {
    const { recordContactEvent } = await import("@/lib/db/contacts")
    await recordContactEvent({
      email: "dana@example.com", name: "Dana Reyes", source: "inquiry", businessId: BUSINESS,
    })
    expect(enrollIfTriggered).toHaveBeenCalled()
  })
})
```

Further cases: 401; 403; neither `contactId` nor `person` → 400; a `person` with no email and no phone → 400 (`upsertContactIdentity` requires one); an existing contact who already has an open card on that board → **400 naming the stage they are in**, and no second row; the same collision arriving as a `23505` race → the same message; success → card at the board's position-1 stage with `outcome` null.

- [ ] **Step 3: Run to verify it fails**

- [ ] **Step 4: Implement `createOpportunityManually`**

```ts
/**
 * G29. Puts a person on a board by hand.
 *
 * NEVER CALLS `recordContactEvent`. Enrolment lives inside it
 * (lib/db/contacts.ts, `enrollIfTriggered`), and a hand-made card must not send
 * anybody an email: you already spoke to this person, which is why you are
 * filing them. The same non-enrolling shape `importGhlContact` uses, for the
 * same reason -- history arriving today is not a lead arriving today.
 *
 * A flag like `enrol: false` was considered and rejected: a flag can be passed
 * wrong and the next caller inherits a default. Not calling the enrolling
 * function cannot be passed wrong.
 */
```

Resolve the contact (existing id, or `upsertContactIdentity` + `recordEventForExistingContact` with `source: "manual_card"`), read the board's position-1 stage, insert the opportunity, and catch `23505` on `opportunities_one_open_per_contact_pipeline` → read the existing card's stage name and throw the readable message.

**`ON CONFLICT` cannot infer a partial index** — do not reach for an upsert here; catch the error code.

- [ ] **Step 5: Run to verify it passes**
- [ ] **Step 6: Mutate** — switch the helper to `recordContactEvent` (the enrolment test must fail); flip either Record entry to `true`; drop the `23505` catch; insert at position 0 instead of 1.
- [ ] **Step 7: Run the whole suite, then commit**

---

### Task 7: The editor screen

**Files:**
- Create: `app/(admin)/admin/pipeline/settings/page.tsx`, `components/admin/pipeline-settings.tsx`
- Test: `__tests__/components/admin/pipeline-settings.test.tsx`

- [ ] **Step 1: Write the failing component test**

Assert the PAIRS the screen renders, not that some text exists: each stage row shows its name input, its kind, and both day thresholds; the Save button is disabled while a validator problem is showing; removing a stage that holds cards reveals a destination picker naming the other stages.

**Playwright's `name` is a substring match; Testing Library's is not** — this is a Testing Library suite, so use `{ exact: false }` deliberately where you mean it.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Build the screen**

Server component reads boards + stages + card counts; client component holds the list. Reorder with `@dnd-kit` (already a dependency). Show the validator's problems inline by re-running `validateStageList` client-side — **and remember that is a convenience, not the guard**; the route is the guard.

Follow the house table chrome from `components/ui/data-table.tsx` for any list. Link it from `/admin/pipeline`.

- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Run the whole suite, then commit**

---

### Task 8: The new-card dialog

**Files:**
- Create: `components/admin/new-card-dialog.tsx`
- Modify: `app/(admin)/admin/pipeline/page.tsx` (add the button), `components/admin/pipeline-board.tsx`
- Test: `__tests__/components/admin/new-card-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Cases: the search box lists matching contacts; choosing one hides the new-person fields; "Add someone new" reveals name + email + phone; submitting with neither email nor phone shows the refusal; the server's duplicate-card message is displayed verbatim rather than swallowed.

**The dialog primitive caps no height** — give the contact list its own scroll container, or a long result set runs off the screen.

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Build it** — `components/ui/dialog.tsx`, React Hook Form + Zod resolver, Sonner for the toast.
- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Run the whole suite, then commit**

---

### Task 9: Verification and screenshots

- [ ] **Step 1: Full gates**

```bash
npx vitest run
npx tsc --noEmit 2>&1 | tail -5
npm run build
```

Expected: the 7-failure pre-existing baseline and nothing new; tsc **238 / 54** with a per-file set identical to the stored baseline; build exit 0. If the build fails with `Cannot find module … .next/dev/types/validator.ts`, `rm -rf .next/dev` and rebuild — a stale generated artifact, not your code.

- [ ] **Step 2: Create real cards through the real route**

Drive `/admin/pipeline` in a browser against the dev clone and create cards on all three boards **through the dialog**, not by INSERT. A fixture proves render, not origination.

- [ ] **Step 3: Screenshot**

Per the house standard: the real app, the real route, annotations burned into the PNG, composed at the capture's exact pixel width. Park the pointer before capturing. Admin is light-only, so no dark variant.

Deliver to `screenshots/g29-pipeline-editor/`: the editor with a board loaded; the editor mid-reorder; the refusal when removing a stage that holds cards; the refusal when archiving the default board; the new-card dialog with search results; the duplicate-card refusal; a board with real hand-made cards on it.

- [ ] **Step 4: Whole-branch review**

Eight task reviews passing is not the same as the branch being right — that lesson is already in this repo's memory. Review the merged diff as one change.

- [ ] **Step 5: Update the ledger and journal**

Move G29 to done in `docs/lead-engine-gaps-to-ship-2026-09-19.md` — **edit BOTH the row header and the scoreboard**, which is the exact failure this ledger shipped on 2026-09-21. Add the journal entry.

---

## Self-Review

**Spec coverage:** §2.1 → Tasks 1-2. §2.2 files → Tasks 1-8. §2.3 routes → Tasks 4-6. §3 invariants 1-5 → Tasks 1-3, 5; invariant 6 → Task 3 Step 3 + Task 4 case 6. §4.1 no-enrolment → Task 6 Steps 1, 2, 4. §4.2 search-or-create → Tasks 6, 8. §4.3 card shape and collision → Task 6. §5 testing → every task. §6 traps → carried inline where each applies. §7 out-of-scope → nothing here implements them.

**Placeholders:** Task 3 Step 1 and Task 7/8's tests give case lists rather than full bodies; each is marked as a map with an explicit instruction to write real assertions, and the surrounding conventions are named. Tasks 1, 2 and 6 carry complete code for the parts with real logic.

**Type consistency:** `StageDraft` / `SavedStage` / `StageProblem` / `StageSavePlan` are defined in Task 1 and used unchanged in Tasks 2, 3, 5, 7. `save_pipeline_stages(p_business_id, p_pipeline_id, p_stages, p_move_cards)` matches between Task 2's SQL and Task 3's caller. `createOpportunityManually`'s signature in Task 6 matches its route.

---

## Reconciliation — what the whole-branch review changed after this plan was written

Step 4 ("Whole-branch review") found five Important defects **in the seams between tasks**: each task
was right on its own and the assembly was wrong. Fixed in one wave; the plan text above is left as
written, so read this section where the two disagree.

| # | What was wrong | What changed |
|---|---|---|
| 1 | A move destination that the same save was ALSO removing passed every layer. The SQL moved the cards onto a stage it then deleted (`opportunities_stage_id_fkey`), and a crafted `to_stage_id` naming **another board's** stage relocated real cards there with no error at all. | New pure `invalidDestinationProblems` (`lib/lead-engine/stage-list.ts`), run by `savePipelineStages` and the editor; new migration **`00277`** adds the symmetric `to_stage_id = ANY(v_submitted_ids)` cross-check to `save_pipeline_stages`. |
| 2 | The editor's free `kind` dropdown made `readBoard`'s doc comment false: `won → open` on a stage holding closed cards took every settled deal off the board. | New pure `kindChangeVisibilityProblems`; `readStagesForEdit` now returns a **closed**-card count per stage; refused at the route and the DAL (controller ruling R19), surfaced inline in the editor. `readBoard`'s comment now says why the premise is true. |
| 3 | `createPipelineBoard` seeded Won at position 1 while `createOpportunityManually` files onto position 1 — so the first hand-made card on a new board landed in "Won". | The seed is now THREE stages: `new` / "New enquiry" (open) at 1, `won` at 2, `lost` at 3. **The line at Task 3 and the test name at line 681 of this plan are therefore out of date.** Spec §4.3 fixes the FILING rule at position 1, not the seed. |
| 4 | A mistyped email (`dana@gmail`) with no phone reached `upsertContactIdentity`'s internal throw, and the dialog printed *"upsertContactIdentity needs at least one usable identifier"* on screen. | `createOpportunityManually` normalises BEFORE its pre-check and refuses in English, quoting what was typed. The dialog's now-false comment about `.email()` is corrected. |
| 5 | None of the four routes supplied a `metadata:` callback, though spec §2.3 collapsed five stage slugs into one **on the promise that "the metadata carries the before/after stage list"**. | `metadata:` added to all four: before/after/removed/added stage keys plus the card moves on the stages PUT; `status` + previous name on the board PATCH; the created board's key on the POST; `contact_id`/`opportunity_id` on the opportunities POST. `"3 stage(s) submitted"` is now `"3 stages submitted"` (R16). |

Also folded in: a repo-wide inventory test that `enrollIfTriggered` has exactly one call site (R20); route-side
board-name cap tests; the third divergent "add an email or phone" sentence brought into the family; a `.max()`
on `valueCents`; the board-create refusal test corrected to the shape the route really returns; and
`validateStageList`'s key dedupe made consistent with its emptiness check.

**Step 5 is deliberately NOT done** for `docs/lead-engine-gaps-to-ship-2026-09-19.md` — controller ruling R21.
That file has uncommitted modifications in the main checkout from another session.
