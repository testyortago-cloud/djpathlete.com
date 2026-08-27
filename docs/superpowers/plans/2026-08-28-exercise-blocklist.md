# Exercise Blocklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach permanently block an exercise from AI generation — studio-wide or for one client — so it stops reappearing in every generated day.

**Architecture:** One `exercise_blocks` table with a nullable `client_id` carrying the scope. A twin DAL helper (`lib/db/` for Next.js, `functions/src/lib/` for the Firebase runtime, because `functions/` has `rootDir: "src"` and cannot import from `lib/`) returns a `Set<string>` of blocked ids, which both orchestrators union into the `excludeIds` set their exercise filter already honours. Blocks are added from a ⊘ on the exercise card in a generated day, and reviewed/removed on the AI Policy page (studio-wide) and the client detail screen (per-client).

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Vitest, Firebase Functions (separate `functions/` package), Tailwind v4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-28-exercise-blocklist-design.md`

## Global Constraints

- **Blocks affect AI generation only.** Manual exercise picking, the exercise library, and existing programs are never filtered by a block.
- **Blocks are never relaxed for strict pool mode.** Cross-day variety exclusion is relaxed when `poolActive`; blocks are not.
- **A blocklist read failure degrades to an empty set** and logs a warning. It must never fail a generation.
- **Admin UI is light-only.** Do not add `.dark` variants; the admin components were never built against them.
- **Tables use `components/ui/data-table.tsx`.** Never hand-roll a `<table>`. Compose `DataTableCard` → `DataTable` → `DataTableHeader`/`DataTableHead`/`DataTableRow`/`DataTableCell`/`DataTableEmpty`, with `DataTableBadge` for pills.
- **Colors are semantic classes** (`text-primary`, `bg-accent`, `text-destructive`), never hardcoded hex.
- **No Claude attribution** in any commit message.
- **Targeted test runs only.** `npx vitest run <path>` plus `npx tsc --noEmit`. Never the full suite.
- Web tests run from the repo root; `functions/` tests run from inside `functions/`.

---

### Task 1: Migration, web DAL, and migration test

**Files:**
- Create: `supabase/migrations/00232_exercise_blocks.sql`
- Create: `lib/db/exercise-blocks.ts`
- Test: `__tests__/migrations/00232.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ExerciseBlock` — `{ id: string; coach_id: string; client_id: string | null; exercise_id: string; reason: string | null; created_by: string; created_at: string }`
  - `ExerciseBlockRow` — `ExerciseBlock & { exercises: { id: string; name: string; movement_pattern: string | null } | null }`
  - `getBlockedExerciseIds(coachId: string, clientId: string | null): Promise<Set<string>>`
  - `listStudioBlocks(coachId: string): Promise<ExerciseBlockRow[]>`
  - `listClientBlocks(coachId: string, clientId: string): Promise<ExerciseBlockRow[]>`
  - `createExerciseBlock(input: { coachId: string; clientId: string | null; exerciseId: string; reason: string | null; createdBy: string }): Promise<ExerciseBlock>`
  - `deleteExerciseBlock(coachId: string, id: string): Promise<boolean>`
  - `countUsableInPattern(coachId: string, clientId: string | null, movementPattern: string, excludingExerciseId: string): Promise<number>`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00232_exercise_blocks.sql`:

```sql
-- Migration 00232: Exercise blocklist for AI generation
--
-- A coach-curated set of exercises the AI must never program. Studio-wide when
-- client_id IS NULL, otherwise scoped to that one client. Read at generation
-- time and unioned into the excludeIds hard-prune both orchestrators already
-- apply — see docs/superpowers/specs/2026-08-28-exercise-blocklist-design.md.
--
-- Blocks affect AI SELECTION ONLY. The exercise stays in the library, stays
-- manually pickable, and stays in programs already built.

CREATE TABLE IF NOT EXISTS exercise_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  reason      TEXT,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TWO partial unique indexes, not one constraint. A plain
-- UNIQUE (coach_id, client_id, exercise_id) does NOT stop duplicate
-- studio-wide blocks, because NULL never equals NULL in a unique index —
-- every press of the block button would insert another row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_blocks_studio
  ON exercise_blocks (coach_id, exercise_id) WHERE client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_exercise_blocks_client
  ON exercise_blocks (coach_id, client_id, exercise_id) WHERE client_id IS NOT NULL;

-- The generation-time read is always (coach_id, client_id IS NULL OR client_id = $1).
CREATE INDEX IF NOT EXISTS idx_exercise_blocks_lookup
  ON exercise_blocks (coach_id, client_id);
```

- [ ] **Step 2: Write the failing migration test**

Create `__tests__/migrations/00232.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("Migration 00232: exercise blocks", () => {
  const supabase = createServiceRoleClient()

  it("exercise_blocks table exists with required columns", async () => {
    const { data, error } = await supabase
      .from("exercise_blocks")
      .select("id,coach_id,client_id,exercise_id,reason,created_by,created_at")
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("rejects a block referencing an exercise that does not exist", async () => {
    const { error } = await supabase.from("exercise_blocks").insert({
      coach_id: "00000000-0000-0000-0000-000000000001",
      exercise_id: "00000000-0000-0000-0000-000000000002",
      created_by: "00000000-0000-0000-0000-000000000001",
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/foreign key|violates/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run __tests__/migrations/00232.test.ts`
Expected: FAIL — the first test errors because `exercise_blocks` does not exist yet (PostgREST reports the relation is missing).

- [ ] **Step 4: Apply the migration to dev**

Run: `node scripts/migrations/apply.mjs`

This applies every migration `public.repo_migrations` has not recorded, in filename order, and stops at the first failure. Confirm the output names `00232_exercise_blocks.sql` as applied.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/migrations/00232.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the web DAL**

Create `lib/db/exercise-blocks.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface ExerciseBlock {
  id: string
  coach_id: string
  client_id: string | null
  exercise_id: string
  reason: string | null
  created_by: string
  created_at: string
}

export interface ExerciseBlockRow extends ExerciseBlock {
  exercises: { id: string; name: string; movement_pattern: string | null } | null
}

const ROW_SELECT = "id,coach_id,client_id,exercise_id,reason,created_by,created_at,exercises(id,name,movement_pattern)"

/**
 * Every exercise id blocked for this generation: the coach's studio-wide
 * blocks, plus this client's own. Returns an EMPTY SET on failure — a
 * blocklist outage must degrade to today's behaviour, never fail a run.
 */
export async function getBlockedExerciseIds(coachId: string, clientId: string | null): Promise<Set<string>> {
  const supabase = getClient()
  let query = supabase.from("exercise_blocks").select("exercise_id").eq("coach_id", coachId)
  query = clientId ? query.or(`client_id.is.null,client_id.eq.${clientId}`) : query.is("client_id", null)
  const { data, error } = await query
  if (error) {
    console.warn("[exercise-blocks] getBlockedExerciseIds failed:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}

export async function listStudioBlocks(coachId: string): Promise<ExerciseBlockRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .select(ROW_SELECT)
    .eq("coach_id", coachId)
    .is("client_id", null)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ExerciseBlockRow[]
}

export async function listClientBlocks(coachId: string, clientId: string): Promise<ExerciseBlockRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .select(ROW_SELECT)
    .eq("coach_id", coachId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ExerciseBlockRow[]
}

export interface CreateExerciseBlockInput {
  coachId: string
  clientId: string | null
  exerciseId: string
  reason: string | null
  createdBy: string
}

/**
 * Idempotent by design. The block button is one click and a double press must
 * not read as an error, so an existing block is returned as-is rather than
 * conflicting. The two partial unique indexes make the race safe.
 */
export async function createExerciseBlock(input: CreateExerciseBlockInput): Promise<ExerciseBlock> {
  const supabase = getClient()
  const existingQuery = supabase
    .from("exercise_blocks")
    .select("id,coach_id,client_id,exercise_id,reason,created_by,created_at")
    .eq("coach_id", input.coachId)
    .eq("exercise_id", input.exerciseId)
  const { data: existing } = await (input.clientId
    ? existingQuery.eq("client_id", input.clientId)
    : existingQuery.is("client_id", null)
  ).maybeSingle()
  if (existing) return existing as ExerciseBlock

  const { data, error } = await supabase
    .from("exercise_blocks")
    .insert({
      coach_id: input.coachId,
      client_id: input.clientId,
      exercise_id: input.exerciseId,
      reason: input.reason,
      created_by: input.createdBy,
    })
    .select("id,coach_id,client_id,exercise_id,reason,created_by,created_at")
    .single()
  if (error) throw error
  return data as ExerciseBlock
}

/** Returns false when the id matched no row for this coach. */
export async function deleteExerciseBlock(coachId: string, id: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_blocks")
    .delete()
    .eq("coach_id", coachId)
    .eq("id", id)
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * How many exercises would still be available in `movementPattern` if
 * `excludingExerciseId` were blocked for this scope. Zero means the block
 * starves the pattern and the coach gets a warning before committing.
 */
export async function countUsableInPattern(
  coachId: string,
  clientId: string | null,
  movementPattern: string,
  excludingExerciseId: string,
): Promise<number> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercises")
    .select("id")
    .eq("movement_pattern", movementPattern)
  if (error) throw error
  const blocked = await getBlockedExerciseIds(coachId, clientId)
  return (data ?? []).filter(
    (e: { id: string }) => e.id !== excludingExerciseId && !blocked.has(e.id),
  ).length
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "exercise-blocks|00232" || echo "no errors in new files"`
Expected: `no errors in new files`. (The repo has a pre-existing baseline of unrelated `tsc` errors — grep for your own files rather than reading the whole output.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00232_exercise_blocks.sql lib/db/exercise-blocks.ts __tests__/migrations/00232.test.ts
git commit -m "feat(exercises): exercise_blocks table and web data layer

Studio-wide when client_id IS NULL, per-client otherwise. Two partial unique
indexes rather than one constraint, because NULL never equals NULL in a unique
index and every studio-wide block would otherwise insert a duplicate row."
```

---

### Task 2: Functions-runtime twin helper

**Files:**
- Create: `functions/src/lib/exercise-blocks.ts`
- Test: `functions/src/lib/__tests__/exercise-blocks.test.ts`

**Interfaces:**
- Consumes: `getSupabase()` from `functions/src/lib/supabase.js`.
- Produces: `getBlockedExerciseIdsFromFn(coachId: string, clientId: string | null): Promise<Set<string>>` — same contract as the web `getBlockedExerciseIds`, including the degrade-to-empty-set behaviour.

**Why a twin and not an import:** `functions/` has `rootDir: "src"` and cannot import from `lib/`. This is the established pattern — see `functions/src/lib/cron-runs.ts` ↔ `lib/db/cron-runs.ts`.

- [ ] **Step 1: Write the failing test**

Create `functions/src/lib/__tests__/exercise-blocks.test.ts`. Follow the mocking shape used by `functions/src/ai/__tests__/usage-history.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.hoisted(() => vi.fn())
vi.mock("../supabase.js", () => ({ getSupabase: () => ({ from: fromMock }) }))

import { getBlockedExerciseIdsFromFn } from "../exercise-blocks.js"

/** Minimal PostgREST builder stub: every filter returns `this`, awaiting resolves. */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "or"]) b[m] = vi.fn(() => b)
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}

describe("getBlockedExerciseIdsFromFn", () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it("returns the blocked ids as a Set", async () => {
    fromMock.mockReturnValue(builder({ data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null }))
    const ids = await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(ids).toEqual(new Set(["a", "b"]))
  })

  // These two assert the QUERY SHAPE, which is the whole leak protection: the
  // filter is what stops another client's blocks reaching this generation.
  // Asserting on returned rows would pass against a mock no matter what filter
  // was sent.
  it("unions studio-wide with this client when a client id is given", async () => {
    const b = builder({ data: [], error: null })
    fromMock.mockReturnValue(b)
    await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(b.or).toHaveBeenCalledWith("client_id.is.null,client_id.eq.client-1")
    expect(b.is).not.toHaveBeenCalled()
  })

  it("reads studio-wide only when there is no client", async () => {
    const b = builder({ data: [], error: null })
    fromMock.mockReturnValue(b)
    await getBlockedExerciseIdsFromFn("coach-1", null)
    expect(b.is).toHaveBeenCalledWith("client_id", null)
    expect(b.or).not.toHaveBeenCalled()
  })

  it("degrades to an empty Set on error rather than throwing", async () => {
    fromMock.mockReturnValue(builder({ data: null, error: { message: "boom" } }))
    const ids = await getBlockedExerciseIdsFromFn("coach-1", "client-1")
    expect(ids).toEqual(new Set())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from the `functions/` directory: `cd functions && npx vitest run src/lib/__tests__/exercise-blocks.test.ts`
Expected: FAIL — cannot resolve `../exercise-blocks.js`.

- [ ] **Step 3: Write the implementation**

Create `functions/src/lib/exercise-blocks.ts`:

```ts
import { getSupabase } from "./supabase.js"

/**
 * Twin of `getBlockedExerciseIds` in lib/db/exercise-blocks.ts. `functions/`
 * has rootDir "src" and cannot import from lib/, so this is a deliberate copy —
 * keep the two in step.
 *
 * Returns an EMPTY SET on failure. A blocklist outage must degrade to today's
 * behaviour, never fail a generation.
 */
export async function getBlockedExerciseIdsFromFn(
  coachId: string,
  clientId: string | null,
): Promise<Set<string>> {
  const supabase = getSupabase()
  let query = supabase.from("exercise_blocks").select("exercise_id").eq("coach_id", coachId)
  query = clientId ? query.or(`client_id.is.null,client_id.eq.${clientId}`) : query.is("client_id", null)
  const { data, error } = await query
  if (error) {
    console.warn("[exercise-blocks] getBlockedExerciseIdsFromFn failed:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd functions && npx vitest run src/lib/__tests__/exercise-blocks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/exercise-blocks.ts functions/src/lib/__tests__/exercise-blocks.test.ts
git commit -m "feat(exercises): blocklist reader for the functions runtime

Twin of the web DAL — functions/ has rootDir src and cannot import lib/.
Degrades to an empty set on a failed read so a blocklist outage can never
fail a generation."
```

---

### Task 3: Union blocks into the week/day orchestrator

This is the task that makes the feature real: the day generator is what the coach complained about.

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts` (context fetch ~:434, pool guard ~:891, `excludeIds` ~:911, remap ~:924)
- Test: `functions/src/ai/__tests__/week-orchestrator-blocks.test.ts`
- Test: `functions/src/ai/__tests__/exercise-filter-blocks.test.ts`

**Interfaces:**
- Consumes: `getBlockedExerciseIdsFromFn(coachId, clientId)` from Task 2.
- Produces: no new exports. Behaviour: blocked ids appear in `excludeIds`; the strict-pool empty guard runs after the union; `remapUncoveredSlotPatterns` runs when blocks are present.

- [ ] **Step 1: Add the import and the context fetch**

In `functions/src/ai/week-orchestrator.ts`, add near the other `functions/src/lib` imports:

```ts
import { getBlockedExerciseIdsFromFn } from "../lib/exercise-blocks.js"
```

Add an eighth entry to the `Promise.all` destructure at ~:434, keeping the existing seven in order:

```ts
const [program, existingExercises, fullLibrary, coachPolicy, coachUsage, clientUsage, favoriteIds, blockedIds] =
  await Promise.all([
    // ... the seven existing entries, unchanged ...
    getBlockedExerciseIdsFromFn(requestedBy, request.client_id ?? null).catch(() => new Set<string>()),
  ])
```

Extend the context log line immediately below it:

```ts
console.log(
  `[week-orchestrator] policy: ${coachPolicy ? "loaded" : "none"}, coach usage: ${coachUsage.size}, client usage: ${clientUsage.size}, blocked: ${blockedIds.size}`,
)
```

- [ ] **Step 2: Union blocks into excludeIds**

Replace the `excludeIds` construction at ~:911:

```ts
  // Cross-day variety exclusions, plus anything the coach explicitly banned in
  // this run's instructions, plus the persistent blocklist.
  //
  // Blocks are NOT relaxed for strict pool mode the way cross-day exclusion is.
  // A block is an explicit standing instruction from the coach and outranks the
  // pool; the pool says "prefer these", a block says "never this".
  const excludeIds = new Set([
    ...resolveCrossDayExcludeIds(priorContext, VARIETY_ROLES, poolActive),
    ...intentResolution.bannedIds,
    ...blockedIds,
  ])
```

- [ ] **Step 3: Move the strict-pool empty guard below the union**

The guard currently at ~:891 runs BEFORE `excludeIds` exists, so a pool whose every exercise is blocked sails past it and dies later with a worse error. Delete it from its current position and re-insert it immediately after the `excludeIds` construction from Step 2, now measuring the pruned set:

```ts
  // A strict pool that matched no usable exercises is a dead end — fail with an
  // actionable message instead of letting the selector run on an empty library
  // and silently persisting a blank day/week.
  //
  // Measured AFTER excludeIds, because blocks can empty a pool that the raw
  // pool filter left non-empty.
  const poolAfterExclusions = exercisesForSelection.filter((e) => !excludeIds.has(e.id))
  if (poolActive && poolAfterExclusions.length === 0) {
    throw new Error(
      `Exercise Pool matched no usable exercises for ${isSingleDay ? targetDayName : `Week ${newWeekNumber}`}: ` +
        `the pool selections may reference removed exercises, every pool exercise may be blocked, or all are ` +
        `excluded for this client (injury filter). Update the pool, remove a block, or switch it to Preferred mode.`,
    )
  }
```

- [ ] **Step 4: Fix the starvation re-route condition AND its input**

The remap at ~:924 runs only `if (poolActive)` and is handed `exercisesForSelection` — the library BEFORE exclusions — so it cannot see that a pattern just went empty. Replace it:

```ts
  // Coerce any slot pattern the surviving candidates can't fill onto the nearest
  // pattern they CAN. The architect plans from split conventions and can demand
  // patterns (carry, locomotion, …) that a small curated pool — or the coach's
  // blocklist — has emptied. Without this the generation hard-fails even though
  // the coach's setup is fine.
  //
  // Must be handed the EXCLUSION-PRUNED set: passing the raw library hides the
  // very starvation this is here to absorb.
  if (poolActive || blockedIds.size > 0) {
    const remaps = remapUncoveredSlotPatterns(skeleton.weeks, poolAfterExclusions)
    if (remaps.length > 0) {
      console.log(
        `[week-orchestrator] Remapped ${remaps.length} slot pattern(s) to available coverage:`,
        remaps.map((r) => `${r.slot_id} ${r.from}→${r.to}`).join(", "),
      )
    }
  }
```

- [ ] **Step 5: Write the tests**

Create `functions/src/ai/__tests__/week-orchestrator-blocks.test.ts`. Read the existing `week-orchestrator.test.ts` first and reuse its mock scaffolding verbatim — it already mocks the Anthropic agent calls, the DB reads, and `recordUsageFromFn`. Add a mock for the new module alongside them:

```ts
const blockedIdsMock = vi.hoisted(() => vi.fn(async () => new Set<string>()))
vi.mock("../../lib/exercise-blocks.js", () => ({ getBlockedExerciseIdsFromFn: blockedIdsMock }))
```

Then assert, capturing `filterOptions` via the existing `semanticFilterExercises` mock:

```ts
it("a studio-wide block reaches excludeIds", async () => {
  blockedIdsMock.mockResolvedValueOnce(new Set(["blocked-ex"]))
  await generateWeek(/* the fixture request the sibling suite uses */)
  const opts = semanticFilterMock.mock.calls[0][4]
  expect(opts.excludeIds.has("blocked-ex")).toBe(true)
})

it("a block is NOT relaxed when a strict pool is active", async () => {
  // Cross-day variety exclusion IS relaxed for poolActive; blocks must not be.
  blockedIdsMock.mockResolvedValueOnce(new Set(["blocked-ex"]))
  await generateWeek(/* same fixture, plus pool_exercise_ids + pool_mode: "strict" */)
  const opts = semanticFilterMock.mock.calls[0][4]
  expect(opts.excludeIds.has("blocked-ex")).toBe(true)
})

it("fails with a message naming blocks when blocks empty a strict pool", async () => {
  blockedIdsMock.mockResolvedValueOnce(new Set(["pool-ex-1", "pool-ex-2"]))
  await expect(
    generateWeek(/* fixture with pool_exercise_ids: ["pool-ex-1","pool-ex-2"], pool_mode: "strict" */),
  ).rejects.toThrow(/blocked/i)
})

it("a failed blocklist read does not fail the generation", async () => {
  blockedIdsMock.mockRejectedValueOnce(new Error("db down"))
  await expect(generateWeek(/* plain fixture */)).resolves.toBeDefined()
})
```

- [ ] **Step 6: Pin the two filter-level properties the orchestrator tests cannot see**

The orchestrator tests mock `semanticFilterExercises`, so they prove what is *handed
to* the filter, never what the filter *does with it*. `ensurePatternBalance` is the one
path inside the filter that ignores usage penalties and re-injects exercises, which makes
it the natural leak. Pin it directly.

Create `functions/src/ai/__tests__/exercise-filter-blocks.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { scoreAndFilterExercises } from "../exercise-filter.js"
import { remapUncoveredSlotPatterns } from "../shared-helpers.js"

/** One exercise, shaped enough for the scorer. */
function ex(id: string, movement_pattern: string) {
  return {
    id,
    name: id,
    movement_pattern,
    primary_muscles: ["core"],
    secondary_muscles: [],
    equipment_required: [],
    is_bodyweight: true,
    difficulty: "intermediate",
    training_intent: ["build"],
    sport_tags: [],
    joints_loaded: [],
    plane_of_motion: ["sagittal"],
  }
}

const skeleton = {
  weeks: [
    {
      week_number: 1,
      days: [
        {
          day_of_week: 1,
          slots: [
            { slot_id: "s1", movement_pattern: "carry", target_muscles: ["core"], role: "accessory" },
          ],
        },
      ],
    },
  ],
}
const analysis = { training_age_category: "intermediate" }

describe("blocks and the exercise filter", () => {
  it("ensurePatternBalance cannot backfill a blocked exercise", () => {
    // Only two carries exist and the skeleton demands a carry, so the
    // pattern-balance top-up WILL fire. It must still not resurrect the block.
    const library = [ex("carry-blocked", "carry"), ex("carry-ok", "carry"), ex("push-1", "push")]
    const out = scoreAndFilterExercises(library, skeleton, [], analysis, {
      excludeIds: new Set(["carry-blocked"]),
    })
    expect(out.map((e) => e.id)).not.toContain("carry-blocked")
    // Presence control: without it, an empty result would pass the line above.
    expect(out.map((e) => e.id)).toContain("carry-ok")
  })

  it("remapUncoveredSlotPatterns re-routes a pattern the blocks emptied", () => {
    // The carry slot has no surviving candidate; the remap must move it onto a
    // pattern that does. This is what stops a starving block from dead-ending
    // the selector when no pool is involved.
    const survivors = [ex("push-1", "push"), ex("push-2", "push")]
    const weeks = JSON.parse(JSON.stringify(skeleton.weeks))
    const remaps = remapUncoveredSlotPatterns(weeks, survivors)
    expect(remaps.length).toBe(1)
    expect(remaps[0].from).toBe("carry")
    expect(weeks[0].days[0].slots[0].movement_pattern).not.toBe("carry")
  })
})
```

If the `CompressedExercise` shape has required fields beyond those in `ex()`, read
`functions/src/ai/types.ts` and add them — do not cast to `any` to get past a type error.
A fixture that does not match the real schema is how plan-authored tests end up unable to
fail.

- [ ] **Step 7: Run the tests**

Run: `cd functions && npx vitest run src/ai/__tests__/week-orchestrator-blocks.test.ts src/ai/__tests__/exercise-filter-blocks.test.ts src/ai/__tests__/week-orchestrator.test.ts`
Expected: PASS, and the pre-existing `week-orchestrator.test.ts` still passes — Step 3 moved a guard, so a regression there is the signal that the move broke an existing path.

- [ ] **Step 8: Verify the mutations actually kill**

Do not trust a green suite to prove these tests bind. Apply each mutation, re-run, confirm RED, then revert:

1. Drop `...blockedIds` from the `excludeIds` set → test 1 must fail.
2. Change the union to skip blocks when `poolActive` → test 2 must fail.
3. Move the empty-pool guard back above the union → test 3 must fail.
4. Change `.catch(() => new Set())` to rethrow → test 4 must fail.

5. Delete the `excludeIds` argument from the `ensurePatternBalance` call site → the
   filter test in Step 6 must fail.

A mutation that survives means the test pins something else. Read each mutation's diff
rather than trusting the comment describing it — a comment-only edit is not a mutation.

- [ ] **Step 9: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts functions/src/ai/__tests__/week-orchestrator-blocks.test.ts functions/src/ai/__tests__/exercise-filter-blocks.test.ts
git commit -m "feat(exercises): blocked exercises are pruned from week and day generation

Blocks join excludeIds, which the semantic filter, the heuristic fallback, the
pool rescue injection and the pattern-balance backfill all already honour.

Two ordering fixes came with it. The strict-pool empty guard ran before
excludeIds was built, so a fully-blocked pool passed it and died later with a
worse error. And the starvation re-route was handed the library before
exclusions, so it could not see the pattern it exists to absorb."
```

---

### Task 4: Union blocks into the full-program orchestrator

**Files:**
- Modify: `functions/src/ai/orchestrator.ts` (context fetch ~:351, remap ~:603, `filterOptions.excludeIds` ~:619)
- Test: `functions/src/ai/__tests__/orchestrator-blocks.test.ts`

**Interfaces:**
- Consumes: `getBlockedExerciseIdsFromFn` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Add the import and context fetch**

```ts
import { getBlockedExerciseIdsFromFn } from "../lib/exercise-blocks.js"
```

Add to the `Promise.all` at ~:351 alongside `getCoachRecentUsageFromFn`, binding `blockedIds`:

```ts
      getBlockedExerciseIdsFromFn(requestedBy, request.client_id ?? null).catch((e) => {
        console.warn("[orchestrator:sync] blocklist fetch failed:", e instanceof Error ? e.message : e)
        return new Set<string>()
      }),
```

- [ ] **Step 2: Union into excludeIds**

Replace `excludeIds: intentResolution.bannedIds,` at ~:619 with:

```ts
      // Instruction-parsed bans for this run, plus the coach's persistent
      // blocklist. Never relaxed for strict pool mode — see the week
      // orchestrator for the reasoning.
      excludeIds: new Set([...intentResolution.bannedIds, ...blockedIds]),
```

- [ ] **Step 3: Fix the remap condition and input**

Replace the `if (poolActive)` remap block at ~:603:

```ts
    if (poolActive || blockedIds.size > 0) {
      const candidatesAfterExclusions = compressed.filter(
        (e) => !intentResolution.bannedIds.has(e.id) && !blockedIds.has(e.id),
      )
      const remaps = remapUncoveredSlotPatterns(skeleton.weeks, candidatesAfterExclusions)
      if (remaps.length > 0) {
        console.log(
          `[orchestrator:sync] Remapped ${remaps.length} slot pattern(s) to available coverage:`,
          remaps.map((r) => `${r.slot_id} ${r.from}→${r.to}`).join(", "),
        )
      }
    }
```

- [ ] **Step 4: Write the tests**

Create `functions/src/ai/__tests__/orchestrator-blocks.test.ts`, reusing the mock scaffolding from the existing orchestrator suite. Assert the same two core properties:

```ts
it("a block reaches excludeIds on a full program generation", async () => {
  blockedIdsMock.mockResolvedValueOnce(new Set(["blocked-ex"]))
  await generateProgram(/* the fixture request the sibling suite uses */)
  const opts = semanticFilterMock.mock.calls[0][4]
  expect(opts.excludeIds.has("blocked-ex")).toBe(true)
})

it("instruction bans and blocks both survive the union", async () => {
  blockedIdsMock.mockResolvedValueOnce(new Set(["blocked-ex"]))
  await generateProgram(/* fixture whose admin_instructions ban a named exercise */)
  const opts = semanticFilterMock.mock.calls[0][4]
  expect(opts.excludeIds.has("blocked-ex")).toBe(true)
  expect(opts.excludeIds.size).toBeGreaterThan(1)
})
```

The second test exists because replacing a `Set` with a union is exactly where one of the two inputs gets dropped.

- [ ] **Step 5: Run the tests**

Run: `cd functions && npx vitest run src/ai/__tests__/`
Expected: PASS, all suites — the baseline before this work was 197 tests across 18 files, so the count should now exceed that with no failures.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/orchestrator.ts functions/src/ai/__tests__/orchestrator-blocks.test.ts
git commit -m "feat(exercises): blocked exercises are pruned from full program generation

Mirrors the week orchestrator. The union is the risky edit — a Set replaced by
a union of two is where one input silently gets dropped — so a test pins that
instruction bans and blocks both survive it."
```

---

### Task 5: API routes, audit slugs, and the starvation check

**Files:**
- Create: `app/api/admin/exercises/blocks/route.ts` (POST, GET)
- Create: `app/api/admin/exercises/blocks/[id]/route.ts` (DELETE)
- Modify: `lib/audit/actions.ts` (add two slugs after the `exercise.*` rows at ~:38-40)
- Test: `__tests__/api/exercise-blocks.test.ts`

**Interfaces:**
- Consumes: everything from Task 1's DAL.
- Produces:
  - `POST /api/admin/exercises/blocks` — body `{ exercise_id: string; client_id?: string | null; reason?: string | null }` → `200 { block: ExerciseBlock; remainingInPattern: number | null }`
  - `GET /api/admin/exercises/blocks?client_id=<uuid>` → `200 { blocks: ExerciseBlockRow[] }`; omit `client_id` for studio-wide
  - `DELETE /api/admin/exercises/blocks/[id]` → `200 { ok: true }` / `404`

`remainingInPattern` is `null` when the exercise has no `movement_pattern`; `0` means the block starved the pattern and the UI shows the warning.

- [ ] **Step 1: Add the audit slugs**

In `lib/audit/actions.ts`, immediately after the `exercise.deleted` row (~:40):

```ts
  { slug: "exercise_block.added", category: "admin_write", description: "Exercise blocked from AI generation" },
  { slug: "exercise_block.removed", category: "admin_write", description: "Exercise unblocked for AI generation" },
```

- [ ] **Step 2: Write the failing route tests**

Create `__tests__/api/exercise-blocks.test.ts`. Mock `@/lib/auth` and `@/lib/db/exercise-blocks` following the shape of the existing `__tests__/api/` suites:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({ auth: authMock }))

const createBlockMock = vi.hoisted(() => vi.fn())
const deleteBlockMock = vi.hoisted(() => vi.fn())
const countUsableMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/exercise-blocks", () => ({
  createExerciseBlock: createBlockMock,
  deleteExerciseBlock: deleteBlockMock,
  countUsableInPattern: countUsableMock,
  listStudioBlocks: vi.fn(async () => []),
  listClientBlocks: vi.fn(async () => []),
}))
vi.mock("@/lib/db/exercises", () => ({
  getExerciseById: vi.fn(async () => ({ id: "ex-1", name: "Suitcase carry-Core", movement_pattern: "carry" })),
}))

import { POST } from "@/app/api/admin/exercises/blocks/route"

const ADMIN = { user: { id: "coach-1", role: "admin", email: "c@x.com" } }

function post(body: unknown) {
  return new Request("http://localhost/api/admin/exercises/blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/exercises/blocks", () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: a leaked *Once implementation crosses
    // test boundaries and misattributes the failure to the wrong case.
    vi.resetAllMocks()
    authMock.mockResolvedValue(ADMIN)
    countUsableMock.mockResolvedValue(3)
  })

  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  it("rejects a non-admin caller", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
  })

  it("creates a studio-wide block when no client_id is given", async () => {
    createBlockMock.mockResolvedValue({ id: "b1", client_id: null, exercise_id: "ex-1" })
    const res = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(createBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ coachId: "coach-1", clientId: null, exerciseId: "ex-1" }),
    )
  })

  it("scopes the block to a client when client_id is given", async () => {
    createBlockMock.mockResolvedValue({ id: "b2", client_id: "client-9", exercise_id: "ex-1" })
    await POST(post({ exercise_id: "ex-1", client_id: "client-9" }), { params: Promise.resolve({}) })
    expect(createBlockMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-9" }))
  })

  it("reports remainingInPattern so the caller can warn about starvation", async () => {
    createBlockMock.mockResolvedValue({ id: "b3", client_id: null, exercise_id: "ex-1" })
    countUsableMock.mockResolvedValue(0)
    const res = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    const body = await res.json()
    expect(body.remainingInPattern).toBe(0)
  })

  it("is idempotent — a second block returns 200, not a conflict", async () => {
    createBlockMock.mockResolvedValue({ id: "b1", client_id: null, exercise_id: "ex-1" })
    const first = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    const second = await POST(post({ exercise_id: "ex-1" }), { params: Promise.resolve({}) })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it("rejects a body with no exercise_id", async () => {
    const res = await POST(post({}), { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/exercise-blocks.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 4: Write the POST/GET route**

Create `app/api/admin/exercises/blocks/route.ts`:

```ts
// Add and list exercise blocks. A block is a standing instruction that the AI
// must never program an exercise — studio-wide, or for one client.
//
// Blocks affect AI SELECTION ONLY. This route never touches the exercise
// library and never touches programs already built.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  createExerciseBlock,
  listStudioBlocks,
  listClientBlocks,
  countUsableInPattern,
} from "@/lib/db/exercise-blocks"
import { getExerciseById } from "@/lib/db/exercises"

const createSchema = z.object({
  exercise_id: z.string().uuid(),
  client_id: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
})

export const POST = withAudit(
  {
    action: "exercise_block.added",
    category: "admin_write",
    target: async (request) => {
      const body = await request.json().catch(() => null)
      const id = (body as { exercise_id?: unknown } | null)?.exercise_id
      return typeof id === "string" ? { type: "exercise", id } : undefined
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const parsed = createSchema.safeParse(await request.clone().json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "exercise_id is required" }, { status: 400 })
    }

    const clientId = parsed.data.client_id ?? null
    const block = await createExerciseBlock({
      coachId: session.user.id,
      clientId,
      exerciseId: parsed.data.exercise_id,
      reason: parsed.data.reason ?? null,
      createdBy: session.user.id,
    })

    // Recomputed AFTER the write so the answer reflects the moment of writing,
    // not the moment the dialog opened.
    const exercise = await getExerciseById(parsed.data.exercise_id)
    const remainingInPattern = exercise?.movement_pattern
      ? await countUsableInPattern(session.user.id, clientId, exercise.movement_pattern, parsed.data.exercise_id)
      : null

    return NextResponse.json({ block, remainingInPattern })
  },
)

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const clientId = new URL(request.url).searchParams.get("client_id")
  const blocks = clientId
    ? await listClientBlocks(session.user.id, clientId)
    : await listStudioBlocks(session.user.id)
  return NextResponse.json({ blocks })
}
```

If `getExerciseById` does not exist in `lib/db/exercises.ts`, use whatever single-exercise getter that file exports and adjust the mock in Step 2 to match. Check before writing — do not invent a DAL function.

- [ ] **Step 5: Write the DELETE route**

Create `app/api/admin/exercises/blocks/[id]/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { deleteExerciseBlock } from "@/lib/db/exercise-blocks"

export const DELETE = withAudit(
  {
    action: "exercise_block.removed",
    category: "admin_write",
    target: async (_request, context) => {
      const { id } = await context.params
      return id ? { type: "exercise_block", id } : undefined
    },
  },
  async (_request, context) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await context.params
    // Scoped by coach_id in the DAL, so one coach cannot delete another's block.
    const removed = await deleteExerciseBlock(session.user.id, id)
    if (!removed) return NextResponse.json({ error: "Block not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  },
)
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run __tests__/api/exercise-blocks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/exercises/blocks lib/audit/actions.ts __tests__/api/exercise-blocks.test.ts
git commit -m "feat(exercises): routes to add, list and remove exercise blocks

POST is idempotent — the block button is one click and a double press must not
read as an error. It returns remainingInPattern so the caller can warn when a
block leaves a movement pattern with nothing in it."
```

---

### Task 6: The ⊘ on the exercise card

**Files:**
- Create: `components/admin/BlockExerciseDialog.tsx`
- Modify: `components/admin/ExerciseCard.tsx` (props + hover action row ~:122-140)
- Modify: `components/admin/ProgramBuilder.tsx` (pass the handler down, ~:907)
- Test: `__tests__/components/block-exercise-dialog.test.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/exercises/blocks` from Task 5.
- Produces:
  - `BlockExerciseDialog` props: `{ open: boolean; onOpenChange: (o: boolean) => void; exerciseId: string; exerciseName: string; movementPattern: string | null; clientId?: string; clientName?: string; onBlocked: () => void }`
  - `ExerciseCard` gains one optional prop: `onBlock?: () => void`. Optional so the drag-overlay render sites at `ProgramBuilder.tsx:927` keep working unchanged.

- [ ] **Step 1: Write the failing component test**

Create `__tests__/components/block-exercise-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BlockExerciseDialog } from "@/components/admin/BlockExerciseDialog"

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  exerciseId: "ex-1",
  exerciseName: "Suitcase carry-Core",
  movementPattern: "carry",
  onBlocked: vi.fn(),
}

describe("BlockExerciseDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ block: { id: "b1" }, remainingInPattern: 3 })))
  })

  it("names the exercise and says the block does not touch existing programs", () => {
    render(<BlockExerciseDialog {...baseProps} />)
    expect(screen.getByText(/Suitcase carry-Core/)).toBeInTheDocument()
    expect(screen.getByText(/already built/i)).toBeInTheDocument()
  })

  it("offers a client-scoped option only when a client is given", () => {
    const { rerender } = render(<BlockExerciseDialog {...baseProps} />)
    expect(screen.queryByLabelText(/only/i)).not.toBeInTheDocument()
    rerender(<BlockExerciseDialog {...baseProps} clientId="c-9" clientName="Marcus" />)
    expect(screen.getByLabelText(/Marcus only/i)).toBeInTheDocument()
  })

  it("posts a studio-wide block by default", async () => {
    render(<BlockExerciseDialog {...baseProps} />)
    await userEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body).toMatchObject({ exercise_id: "ex-1" })
    expect(body.client_id ?? null).toBeNull()
  })

  it("posts a client-scoped block when that option is chosen", async () => {
    render(<BlockExerciseDialog {...baseProps} clientId="c-9" clientName="Marcus" />)
    await userEvent.click(screen.getByLabelText(/Marcus only/i))
    await userEvent.click(screen.getByRole("button", { name: "Block" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.client_id).toBe("c-9")
  })

  it("warns when the block leaves the movement pattern empty", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ block: { id: "b1" }, remainingInPattern: 0 })))
    render(<BlockExerciseDialog {...baseProps} />)
    await userEvent.click(screen.getByRole("button", { name: "Block" }))
    // Control for the absence assertion in the previous tests: the warning text
    // must be reachable at all, or "no warning shown" proves nothing.
    await waitFor(() => expect(screen.getByText(/last usable carry/i)).toBeInTheDocument())
  })
})
```

Note the last test: it is the presence control for the absence assertions. An "X is not on screen" test passes just as well when nothing rendered at all.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/components/block-exercise-dialog.test.tsx`
Expected: FAIL — cannot resolve `BlockExerciseDialog`.

- [ ] **Step 3: Write the dialog**

Create `components/admin/BlockExerciseDialog.tsx`. Use the shadcn `Dialog`/`Button`/`Label`/`Textarea`/`RadioGroup` primitives already in `components/ui/`, `toast` from `sonner`, and semantic colour classes only. The copy is fixed by the spec:

- Title: `Block {exerciseName}?`
- Body: "The AI won't program this again. It stays in your library and stays in programs you've already built."
- Scope radio: "For every client" (default, value `studio`) and — only when `clientId` is set — "For {clientName} only" (value `client`).
- Optional reason `Textarea`.
- Footer: `Cancel` and `Block`.
- After a successful POST whose `remainingInPattern === 0`, render the warning inline and keep the dialog open so the coach reads it: `⚠ This is the last usable {movementPattern} in your library. Days that ask for a {movementPattern} will fall back to a related movement.` Then call `onBlocked()`.
- On a non-zero result, toast `"{exerciseName} blocked"`, call `onBlocked()`, and close.

- [ ] **Step 4: Wire the ⊘ into ExerciseCard**

In `components/admin/ExerciseCard.tsx`, add `Ban` to the lucide import, add `onBlock?: () => void` to `ExerciseCardProps` and the destructure, and insert the button into the hover action row before the Trash2 button:

```tsx
        {onBlock && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onBlock}
            title="Block from AI generation"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Ban className="size-3.5" />
          </Button>
        )}
```

Keep it visually quieter than the destructive Trash2 — blocking is not deleting, and the icons sit side by side.

- [ ] **Step 5: Wire ProgramBuilder**

Add `const [blockTarget, setBlockTarget] = useState<(ProgramExercise & { exercises: Exercise }) | null>(null)`, pass `onBlock={() => setBlockTarget(pe)}` alongside the existing `onRemoveExercise` at ~:907, and render `<BlockExerciseDialog>` next to the other dialogs at the bottom, fed from `blockTarget` and the builder's existing `clientId` / client name. `onBlocked` closes the dialog; it must NOT remove the row or refresh the program — a block does not touch an existing program.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run __tests__/components/block-exercise-dialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "BlockExerciseDialog|ExerciseCard|ProgramBuilder" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 8: Commit**

```bash
git add components/admin/BlockExerciseDialog.tsx components/admin/ExerciseCard.tsx components/admin/ProgramBuilder.tsx __tests__/components/block-exercise-dialog.test.tsx
git commit -m "feat(exercises): block an exercise from the day it appeared in

The block button sits on the exercise card, which is where the coach actually
notices the repetition. Blocking never removes the row — the copy says so, so
nobody expects it to vanish."
```

---

### Task 7: Studio-wide list on the AI Policy page

**Files:**
- Create: `components/admin/BlockedExercisesCard.tsx`
- Modify: `app/(admin)/admin/settings/ai-policy/page.tsx` (summary strip ~:46, and a new card below the form)
- Test: `__tests__/components/blocked-exercises-card.test.tsx`

**Interfaces:**
- Consumes: `ExerciseBlockRow` (Task 1), `DELETE /api/admin/exercises/blocks/[id]` (Task 5).
- Produces: `BlockedExercisesCard` props: `{ blocks: ExerciseBlockRow[]; scopeLabel: string; emptyHint: string }`. Reused verbatim by Task 8, so keep it free of any page-specific assumption.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/blocked-exercises-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BlockedExercisesCard } from "@/components/admin/BlockedExercisesCard"

const row = {
  id: "b1",
  coach_id: "coach-1",
  client_id: null,
  exercise_id: "ex-1",
  reason: "Shows up in every single day",
  created_by: "coach-1",
  created_at: "2026-08-28T00:00:00Z",
  exercises: { id: "ex-1", name: "Suitcase carry-Core", movement_pattern: "carry" },
}

describe("BlockedExercisesCard", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
  })

  it("renders the exercise name, pattern and reason", () => {
    render(<BlockedExercisesCard blocks={[row]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    expect(screen.getByText("Suitcase carry-Core")).toBeInTheDocument()
    expect(screen.getByText("carry")).toBeInTheDocument()
    expect(screen.getByText(/every single day/)).toBeInTheDocument()
  })

  it("shows the empty hint when there are no blocks", () => {
    render(<BlockedExercisesCard blocks={[]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    expect(screen.getByText("none yet")).toBeInTheDocument()
  })

  it("unblocks through the DELETE route", async () => {
    render(<BlockedExercisesCard blocks={[row]} scopeLabel="Blocked exercises" emptyHint="none yet" />)
    await userEvent.click(screen.getByRole("button", { name: /unblock/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe("/api/admin/exercises/blocks/b1")
    expect(init.method).toBe("DELETE")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/blocked-exercises-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card**

Create `components/admin/BlockedExercisesCard.tsx` as a `"use client"` component composing the house table primitives — never a hand-rolled `<table>`:

```tsx
import {
  DataTableCard, DataTable, DataTableHeader, DataTableHead,
  DataTableRow, DataTableCell, DataTableEmpty, DataTableBadge,
} from "@/components/ui/data-table"
```

Columns: Exercise (name), Movement pattern (`DataTableBadge` tone `neutral`; render `—` when null), Reason (muted, `—` when null), Blocked (formatted `created_at`), and a right-aligned Unblock button. On click: `DELETE /api/admin/exercises/blocks/<id>`, then `router.refresh()` and a `toast.success`. Optimistically drop the row from local state so the list responds immediately.

- [ ] **Step 4: Mount it on the AI Policy page**

In `app/(admin)/admin/settings/ai-policy/page.tsx`:
- `import { listStudioBlocks } from "@/lib/db/exercise-blocks"` and fetch `const blocks = await listStudioBlocks(session.user.id)` alongside the existing `getCoachPolicy` call.
- Widen the summary strip from `lg:grid-cols-4` to `lg:grid-cols-5` at ~:46 and add a fifth tile using the `Ban` icon already imported by this file, labelled "Blocked" with `{blocks.length}`.
- Render `<BlockedExercisesCard blocks={blocks} scopeLabel="Blocked exercises" emptyHint="No exercises blocked. Use the ⊘ on an exercise in a program to block one." />` below the existing `AiPolicyForm`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run __tests__/components/blocked-exercises-card.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add components/admin/BlockedExercisesCard.tsx "app/(admin)/admin/settings/ai-policy/page.tsx" __tests__/components/blocked-exercises-card.test.tsx
git commit -m "feat(exercises): review and undo studio-wide blocks on the AI policy page

A list you can only add to is a trap — block thirty exercises over a month and
generation quietly narrows with no way to find out why."
```

---

### Task 8: Per-client list on the client detail screen

**Files:**
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (below the Injuries section, ~:452-470)

**Interfaces:**
- Consumes: `BlockedExercisesCard` (Task 7), `listClientBlocks` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Fetch and render**

Add `import { listClientBlocks } from "@/lib/db/exercise-blocks"` and `import { BlockedExercisesCard } from "@/components/admin/BlockedExercisesCard"`. Fetch alongside the page's existing data reads:

```ts
const clientBlocks = await listClientBlocks(session.user.id, clientId)
```

Render directly below the "Injuries & Limitations" section so it reads as the continuation of the injury data that usually motivated the block:

```tsx
<BlockedExercisesCard
  blocks={clientBlocks}
  scopeLabel={`Blocked for ${clientName}`}
  emptyHint="No exercises blocked for this client."
/>
```

Match the surrounding section's spacing and `SectionHeader` usage rather than inventing a new card shell — a page that invents its own variant reads as a different app.

- [ ] **Step 2: Verify it renders and typechecks**

Run: `npx tsc --noEmit 2>&1 | grep -E "clients/\[id\]" || echo "no errors in touched files"`
Expected: `no errors in touched files`.

Then start the dev server (`npm run dev`, port 3050), sign in as admin, open a client detail page, and confirm the card renders below Injuries with the empty hint.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/page.tsx"
git commit -m "feat(exercises): per-client blocked list on the client screen

Sits under Injuries & Limitations, which is usually what motivated the block."
```

---

### Task 9: Drive the real app and capture annotated screenshots

**Files:**
- Create: `scripts/screenshot-exercise-blocks.mjs`
- Create: `screenshots/exercise-blocks/*.png` + `index.html`

- [ ] **Step 1: Seed real state**

Against the dev database, block two exercises for the signed-in coach so no screen is empty:
- `Suitcase carry-Core` studio-wide, reason "Shows up in every single day" — this is also the starvation case, since `carry` holds only four exercises and three are mis-tagged.
- `Weighted deadbug_Core` for one real client.

Seed through the real POST route, not a direct insert — that exercises the code path being photographed.

- [ ] **Step 2: Capture**

Drive the real app with Playwright at 1440px against `npm run dev` on port 3050. It must be the actual product on the actual route — a preview harness or an isolated mount does not count. Capture:

1. `/admin/programs/<id>` — a generated day with the ⊘ visible on a hovered exercise card.
2. The block dialog open on `Suitcase carry-Core`, showing both scope options.
3. The starvation warning after blocking the last carry.
4. `/admin/settings/ai-policy` — the Blocked exercises table with real rows and the new summary tile.
5. `/admin/clients/<id>` — the per-client list under Injuries.

Admin is light-only (`.dark` is a class variant these components were never built against), so capture light only and say so in the review sheet.

- [ ] **Step 3: Annotate**

Burn numbered markers and captions INTO each PNG at the capture's exact pixel width — never upscale, and never wrap a clean screenshot in an HTML page that draws the callouts around it. Write `screenshots/exercise-blocks/index.html` referencing the sibling PNGs.

- [ ] **Step 4: Verify by looking**

Open each PNG and confirm the annotations are present and the UI is the real screen. `ffprobe`-equivalent check: confirm each PNG's pixel width equals the capture width.

- [ ] **Step 5: Commit**

```bash
git add screenshots/exercise-blocks scripts/screenshot-exercise-blocks.mjs
git commit -m "docs(exercises): annotated screenshots of the exercise blocklist"
```

---

## Final verification

- [ ] `cd functions && npx vitest run src/` — all functions tests green (baseline was 197 across 18 files).
- [ ] `npx vitest run __tests__/api/exercise-blocks.test.ts __tests__/components/block-exercise-dialog.test.tsx __tests__/components/blocked-exercises-card.test.tsx __tests__/migrations/00232.test.ts`
- [ ] Confirm the new suites actually bind by running the Task 3 Step 8 mutations once more against the full functions suite, not just the single file.
- [ ] `npx tsc --noEmit` — compare the error count against the pre-work baseline captured at the start of Task 1. A FALLING count hides new errors as readily as a rising one, so compare the file list, not just the number.
- [ ] `npm run build` — the real gate for "did I break compilation anywhere". Grep its output for the touched files.
- [ ] Re-check that `00232` is still the next free migration number before merge. Numbers collide silently across branches and git merges the collision clean.
