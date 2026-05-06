# AI Week/Day Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `functions/src/ai/week-orchestrator.ts` to parity with the full-program pipeline (read coach AI policy + usage history, run a real Agent 1 step, record usage on success), and add two algorithmic upgrades — hard candidate pruning and MMR diversification — that benefit both pipelines.

**Architecture:** No new tables; reuse `generated_exercise_usage` and `coach_ai_policy` from migration 00061. One new column `slot_role` on `program_exercises`. New `WEEK_PROFILE_ANALYZER_PROMPT` reuses the existing `profileAnalysisSchema`. Hard-prune and MMR ship as optional parameters on the shared filter functions, so the full-program orchestrator inherits the upgrades for free.

**Tech Stack:** TypeScript (Firebase Functions), Vitest, Supabase Postgres, Anthropic SDK with Zod schemas, p-retry. Design spec: `docs/superpowers/specs/2026-05-06-ai-week-day-variety-design.md` (commit `830a81c`).

**Solo-dev convention:** Commit directly to `main`. No feature branches. Each task produces one commit.

**Test command (anywhere in plan):** `cd functions && npm test -- <pattern>` or `cd functions && npm test` for everything in `functions/`. The Next.js side uses `npm run test:run`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/00123_program_exercise_slot_role.sql` | Create | Add `slot_role` column to `program_exercises`, backfill from `order_index`, add index |
| `functions/src/ai/exercise-filter.ts` | Modify | Add `excludeIds` and `mmrLambda` optional params on filter functions; add `diversifyByMMR` helper |
| `functions/src/ai/prompts.ts` | Modify | Append `WEEK_PROFILE_ANALYZER_PROMPT` |
| `functions/src/ai/dedup-verify.ts` | Modify | Make `buildPriorContextFromExistingExercises` prefer real `slot_role` over `order_index` inference; export an `excluded_exercise_ids: Set<string>` on `PriorWeekContext` |
| `functions/src/ai/shared-helpers.ts` | Modify | Add `buildExcludeIdSet(priorContext, slotRolesInScope)` and write `slot_role` from `slotDetailsLookup` in `buildExerciseRows` |
| `functions/src/ai/week-orchestrator.ts` | Modify | Fetch coach policy + usage history; run Agent 1 (week-scoped); pass everything into filter; write `slot_role`; record usage |
| `functions/src/ai/__tests__/exercise-filter.test.ts` | Modify | Add tests for `excludeIds`, `diversifyByMMR` |
| `functions/src/ai/__tests__/dedup-verify.test.ts` | Create | Test slot_role-aware prior context |
| `functions/src/ai/__tests__/shared-helpers.test.ts` | Create | Test `buildExcludeIdSet` and `slot_role` writeback |
| `functions/src/ai/__tests__/week-orchestrator.test.ts` | Create | Mock-based integration test for the full week generation flow |

---

## Wave 1 — Independent foundations (4 tasks, parallelizable)

### Task 1: Migration — `slot_role` column + backfill

**Files:**
- Create: `supabase/migrations/00123_program_exercise_slot_role.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 00123: Add slot_role to program_exercises
-- Replaces order_index inference in dedup-verify with explicit role storage.
-- Backfill mirrors current inference: 0 = warm_up, 1-2 = primary_compound, else accessory.

ALTER TABLE program_exercises
  ADD COLUMN IF NOT EXISTS slot_role TEXT;

-- Backfill existing rows using the same inference dedup-verify currently uses.
UPDATE program_exercises
SET slot_role = CASE
  WHEN order_index = 0 THEN 'warm_up'
  WHEN order_index BETWEEN 1 AND 2 THEN 'primary_compound'
  ELSE 'accessory'
END
WHERE slot_role IS NULL;

-- Index for fast role-scoped dedup lookups.
CREATE INDEX IF NOT EXISTS idx_program_exercises_program_role
  ON program_exercises (program_id, slot_role);

COMMENT ON COLUMN program_exercises.slot_role IS
  'Slot role from skeleton (warm_up | primary_compound | secondary_compound | accessory | isolation | cool_down | power | conditioning | activation | testing). Backfilled from order_index for legacy rows.';
```

- [ ] **Step 2: Apply migration via MCP**

Use `mcp__supabase__apply_migration` with name `program_exercise_slot_role` and the SQL body above. (Memory note: this project applies Supabase migrations via MCP, not the CLI.)

- [ ] **Step 3: Verify with `mcp__supabase__list_tables`**

Confirm `program_exercises` shows `slot_role` column (text, nullable). Spot-check a few rows via `mcp__supabase__execute_sql` with `SELECT slot_role, COUNT(*) FROM program_exercises GROUP BY slot_role;` — expect three buckets matching the inference.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00123_program_exercise_slot_role.sql
git commit -m "feat(db): add slot_role column to program_exercises with backfill"
```

---

### Task 2: Hard candidate pruning + MMR diversification

**Files:**
- Modify: `functions/src/ai/exercise-filter.ts`
- Modify: `functions/src/ai/__tests__/exercise-filter.test.ts`

- [ ] **Step 1: Write failing test for `excludeIds` in `scoreAndFilterExercises`**

Append to `functions/src/ai/__tests__/exercise-filter.test.ts`:

```typescript
import { scoreAndFilterExercises, diversifyByMMR } from "../exercise-filter.js"
import type { CompressedExercise, ProgramSkeleton, ProfileAnalysis } from "../types.js"

function ex(id: string, overrides: Partial<CompressedExercise> = {}): CompressedExercise {
  return {
    id, name: id, category: ["strength"], difficulty: "intermediate", difficulty_score: 5,
    muscle_group: "chest", movement_pattern: "push", primary_muscles: ["chest"],
    secondary_muscles: [], force_type: "push", laterality: "bilateral",
    equipment_required: [], is_bodyweight: false, training_intent: ["build"],
    sport_tags: [], plane_of_motion: ["sagittal"], joints_loaded: [], ...overrides,
  } as CompressedExercise
}

const SKELETON: ProgramSkeleton = {
  weeks: [{ week_number: 1, phase: "x", intensity_modifier: "moderate", days: [{
    day_of_week: 1, label: "Push", focus: "chest",
    slots: [{ slot_id: "w1d1s1", role: "primary_compound", movement_pattern: "push",
      target_muscles: ["chest"], sets: 4, reps: "8", rest_seconds: 90,
      rpe_target: 8, tempo: null, group_tag: null, technique: "straight_set",
      intensity_pct: null }] }] }],
  split_type: "full_body", periodization: "linear", total_sessions: 1, notes: "",
}

const ANALYSIS: ProfileAnalysis = {
  recommended_split: "full_body", recommended_periodization: "linear",
  volume_targets: [{ muscle_group: "chest", sets_per_week: 12, priority: "high" }],
  exercise_constraints: [],
  session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5,
    total_exercises: 4, compound_count: 2, isolation_count: 2 },
  training_age_category: "intermediate",
  technique_plan: [{ week_number: 1, allowed_techniques: ["straight_set"],
    default_technique: "straight_set", notes: "" }],
  difficulty_ceiling: [{ week_number: 1, max_tier: "intermediate", max_score: 6 }],
  notes: "",
} as ProfileAnalysis

describe("scoreAndFilterExercises with excludeIds", () => {
  it("removes excluded ids from output even when they top the score", () => {
    const exercises = [ex("a"), ex("b"), ex("c")]
    const result = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      excludeIds: new Set(["a"]),
    })
    expect(result.find((e) => e.id === "a")).toBeUndefined()
    expect(result.length).toBe(2)
  })
})

describe("diversifyByMMR", () => {
  it("returns at most k items with no duplicates", () => {
    const candidates = [
      ex("a", { movement_pattern: "push", primary_muscles: ["chest"] }),
      ex("b", { movement_pattern: "push", primary_muscles: ["chest"] }),
      ex("c", { movement_pattern: "pull", primary_muscles: ["lats"] }),
      ex("d", { movement_pattern: "squat", primary_muscles: ["quads"] }),
    ]
    const scored = candidates.map((c, i) => ({ exercise: c, score: 100 - i }))
    const result = diversifyByMMR(scored, 3, 0.7)
    expect(result.length).toBeLessThanOrEqual(3)
    const ids = result.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("prefers diverse movement patterns over near-duplicate top scorers", () => {
    const a = ex("a", { movement_pattern: "push", primary_muscles: ["chest"] })
    const b = ex("b", { movement_pattern: "push", primary_muscles: ["chest"] })
    const c = ex("c", { movement_pattern: "pull", primary_muscles: ["lats"] })
    const scored = [
      { exercise: a, score: 100 },
      { exercise: b, score: 99 },
      { exercise: c, score: 80 },
    ]
    const result = diversifyByMMR(scored, 2, 0.5)
    const ids = result.map((r) => r.id)
    expect(ids).toContain("a")
    expect(ids).toContain("c")
    expect(ids).not.toContain("b")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd functions && npm test -- exercise-filter`
Expected: FAIL — `diversifyByMMR is not exported`, `excludeIds option not in FilterOptions`.

- [ ] **Step 3: Implement `diversifyByMMR` and extend `FilterOptions`**

Edit `functions/src/ai/exercise-filter.ts`:

After the `FilterOptions` interface, add:

```typescript
export interface FilterOptions {
  poolActive?: boolean
  coachUsage?: UsageRecencyMap
  clientUsage?: UsageRecencyMap
  /** Exercise IDs to physically remove from the candidate set (hard prune). */
  excludeIds?: Set<string>
  /** MMR balance: 1.0 = pure relevance, 0.0 = pure diversity. Default 0.7. */
  mmrLambda?: number
}
```

Then append at the bottom of the file, before any existing trailing exports:

```typescript
// ─── MMR diversification ────────────────────────────────────────────────────

interface MMRSimVector {
  movement_pattern: string
  primary: Set<string>
  equipment: Set<string>
  intent: Set<string>
}

function vectorize(ex: CompressedExercise): MMRSimVector {
  return {
    movement_pattern: ex.movement_pattern ?? "",
    primary: new Set(ex.primary_muscles.map((m) => m.toLowerCase())),
    equipment: new Set(ex.equipment_required.map((e) => e.toLowerCase())),
    intent: new Set(ex.training_intent ?? []),
  }
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const v of a) if (b.has(v)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function mmrSimilarity(a: MMRSimVector, b: MMRSimVector): number {
  const patternMatch = a.movement_pattern && a.movement_pattern === b.movement_pattern ? 1 : 0
  return (
    0.4 * patternMatch +
    0.3 * jaccardSet(a.primary, b.primary) +
    0.2 * jaccardSet(a.equipment, b.equipment) +
    0.1 * jaccardSet(a.intent, b.intent)
  )
}

/**
 * Maximal Marginal Relevance: pick top-k items balancing score (relevance) and
 * diversity from already-selected items. lambda in [0,1]; 1.0 = pure score,
 * 0.0 = pure diversity. Default 0.7.
 */
export function diversifyByMMR(
  scored: Array<{ exercise: CompressedExercise; score: number }>,
  k: number,
  lambda = 0.7,
): CompressedExercise[] {
  if (scored.length <= k) return scored.map((s) => s.exercise)
  const remaining = [...scored]
  const selected: Array<{ exercise: CompressedExercise; vec: MMRSimVector }> = []
  // Normalize scores to [0,1] for fair combination with similarity.
  const maxScore = Math.max(...remaining.map((s) => s.score), 1)
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0
    let bestVal = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      const candVec = vectorize(cand.exercise)
      const rel = cand.score / maxScore
      let maxSim = 0
      for (const sel of selected) {
        const sim = mmrSimilarity(candVec, sel.vec)
        if (sim > maxSim) maxSim = sim
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim
      if (mmr > bestVal) {
        bestVal = mmr
        bestIdx = i
      }
    }
    const pick = remaining.splice(bestIdx, 1)[0]
    selected.push({ exercise: pick.exercise, vec: vectorize(pick.exercise) })
  }
  return selected.map((s) => s.exercise)
}
```

In `scoreAndFilterExercises`, immediately after the `sorted` declaration and before `cutoff`/`slice`, insert:

```typescript
  // Hard-prune excluded IDs (used for cross-week dedup defense in depth)
  const excludeIds = options?.excludeIds
  const sortedAfterExclude = excludeIds && excludeIds.size > 0 ? sorted.filter((e) => !excludeIds.has(e.id)) : sorted
```

Then change `const cutoff = Math.min(maxExercises, sorted.length)` to use `sortedAfterExclude` instead of `sorted`, and the line below it (`let filtered = sorted.slice(0, cutoff)`) likewise. Update the `MIN_EXERCISES` fallback check to use `sortedAfterExclude.length`.

After the slice, replace pure top-N with MMR-diversified top-N when `mmrLambda` is provided:

```typescript
  const lambda = options?.mmrLambda
  if (lambda !== undefined && lambda < 1.0 && filtered.length > MIN_EXERCISES) {
    const scoredFiltered = filtered.map((e) => ({
      exercise: e,
      score: exerciseMaxScores.get(e.id) ?? 0,
    }))
    filtered = diversifyByMMR(scoredFiltered, filtered.length, lambda)
  }
```

In `semanticFilterExercises`, immediately after the line `let filtered = exercises.filter((ex) => matchedIds.has(ex.id))` add:

```typescript
  if (options?.excludeIds && options.excludeIds.size > 0) {
    const before = filtered.length
    filtered = filtered.filter((e) => !options.excludeIds!.has(e.id))
    console.log(`[semanticFilter] excludeIds removed ${before - filtered.length} exercises`)
  }
```

And after the existing `if (filtered.length > maxExercises) filtered = filtered.slice(0, maxExercises)`, add MMR pass:

```typescript
  const lambda = options?.mmrLambda
  if (lambda !== undefined && lambda < 1.0 && filtered.length > MIN_EXERCISES) {
    const baseScore = 50
    const coachUsageMap = options?.coachUsage ?? new Map<string, number>()
    const clientUsageMap = options?.clientUsage ?? new Map<string, number>()
    const scoredFiltered = filtered.map((e) => ({
      exercise: e,
      score: applyUsagePenalty(baseScore, e.id, coachUsageMap, clientUsageMap),
    }))
    filtered = diversifyByMMR(scoredFiltered, filtered.length, lambda)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm test -- exercise-filter`
Expected: PASS — three new tests green plus the existing six.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/exercise-filter.ts functions/src/ai/__tests__/exercise-filter.test.ts
git commit -m "feat(ai): add hard exclude + MMR diversification to exercise filter"
```

---

### Task 3: Week-mode profile analyzer prompt

**Files:**
- Modify: `functions/src/ai/prompts.ts`

- [ ] **Step 1: Append `WEEK_PROFILE_ANALYZER_PROMPT`**

At the very bottom of `functions/src/ai/prompts.ts`, append:

```typescript
// ─── Week-mode Agent 1: Profile Analyzer (single-week scope) ────────────────

export const WEEK_PROFILE_ANALYZER_PROMPT = `You are a performance strategist analyzing ONE WEEK of an existing training program. You will be given the client's profile, the program's prior weeks, the coach's policy, the coach's instructions for this week, and the target week number. You must output a JSON object that constrains how this single week is built.

This is the same role as the full-program Profile Analyzer, but scoped to a single week of an ongoing program. Honor the program's existing trajectory — do not propose a wholesale split or periodization change. Reflect what the program has already established.

Output a JSON object with this EXACT shape (uses the same schema as full-program analysis so existing validation works):

{
  "recommended_split": <one of "full_body" | "upper_lower" | "push_pull_legs" | "push_pull" | "body_part" | "movement_pattern" | "custom"> — MUST equal the program's existing split,
  "recommended_periodization": <one of "linear" | "undulating" | "block" | "reverse_linear" | "none"> — MUST equal the program's existing periodization,
  "volume_targets": [{ "muscle_group": string, "sets_per_week": number, "priority": "high"|"medium"|"low" }],
  "exercise_constraints": [{ "type": "avoid_movement"|"avoid_equipment"|"avoid_muscle"|"limit_load"|"require_unilateral", "value": string, "reason": string }],
  "session_structure": { "warm_up_minutes": number, "main_work_minutes": number, "cool_down_minutes": number, "total_exercises": number, "compound_count": number, "isolation_count": number },
  "training_age_category": "novice"|"intermediate"|"advanced"|"elite",
  "technique_plan": [
    { "week_number": <TARGET WEEK NUMBER, exactly>, "allowed_techniques": [string], "default_technique": string, "notes": string }
  ],
  "difficulty_ceiling": [
    { "week_number": <TARGET WEEK NUMBER, exactly>, "max_tier": "beginner"|"intermediate"|"advanced", "max_score": number }
  ],
  "notes": string
}

CRITICAL RULES:
1. technique_plan and difficulty_ceiling MUST contain EXACTLY ONE entry, with week_number equal to the target week number you are given.
2. allowed_techniques MUST EXCLUDE any technique listed in COACH INSTRUCTIONS as disallowed.
3. allowed_techniques SHOULD prefer techniques the coach lists as preferred, when sensible.
4. Use the program's existing prior weeks to gauge progression. If prior weeks were straight_set only and the target week is week 3+, you MAY introduce ONE additional technique (antagonist superset on accessories OR rest_pause finisher) IF the client is intermediate+ AND the coach has not disallowed it.
5. NOVICES: keep allowed_techniques = ["straight_set"] every week. No exceptions.
6. difficulty_ceiling.max_tier follows the client level: novice→beginner, intermediate→intermediate, advanced/elite→advanced.
7. difficulty_ceiling.max_score: target_week ≤ 2 → 4; target_week 3-5 → 5-6; target_week 6+ → 6-7. Cap LOWER if injuries or stress flags are present.
8. session_structure should reflect the program's prior weeks' shape (look at how many exercises, how many compounds vs accessories prior weeks used) — do NOT redesign the session shape, only confirm it.
9. volume_targets and exercise_constraints should reflect THIS week's intent (deload? progression? same as prior?). When in doubt, mirror prior weeks.
10. Output ONLY the JSON object, no additional text or explanation.

The program structure is fixed. Your job is to set the technique and difficulty constraints for this one week, in keeping with the program's trajectory and the coach's preferences.`
```

- [ ] **Step 2: TypeScript build check**

Run: `cd functions && npm run build`
Expected: PASS — no type errors. (The new export is a plain string, so this will succeed; running the build catches any accidental typos.)

- [ ] **Step 3: Commit**

```bash
git add functions/src/ai/prompts.ts
git commit -m "feat(ai): add WEEK_PROFILE_ANALYZER_PROMPT for week-scoped Agent 1"
```

---

### Task 4: Slot-role-aware prior context

**Files:**
- Modify: `functions/src/ai/dedup-verify.ts`
- Create: `functions/src/ai/__tests__/dedup-verify.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/src/ai/__tests__/dedup-verify.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildPriorContextFromExistingExercises } from "../dedup-verify.js"

describe("buildPriorContextFromExistingExercises with slot_role", () => {
  it("uses provided role over inference when slot_role is set", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-a", exercise_name: "A", week_number: 1, role: "isolation",
        slot_group: "isolation|rotation|obliques" },
    ])
    // 'isolation' is a VARIETY role → should be in used_accessory_exercises, not anchors
    expect(ctx.anchor_exercises.has("ex-a")).toBe(false)
    expect(ctx.used_accessory_exercises.get("isolation|rotation|obliques")?.has("ex-a")).toBe(true)
  })

  it("treats warm_up role as anchor (may repeat)", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-w", exercise_name: "Warm A", week_number: 1, role: "warm_up",
        slot_group: "warm_up|push|chest" },
    ])
    expect(ctx.anchor_exercises.has("ex-w")).toBe(true)
  })

  it("falls back to default 'accessory' role when role is undefined", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-x", exercise_name: "X", week_number: 1 },
    ])
    // Without explicit role, falls back to 'accessory' (default behavior preserved)
    expect(ctx.exercise_week_map.has("ex-x")).toBe(true)
    expect(ctx.anchor_exercises.has("ex-x")).toBe(false)
  })

  it("exposes flat excluded_exercise_ids set scoped to variety roles", () => {
    const ctx = buildPriorContextFromExistingExercises([
      { exercise_id: "ex-a", exercise_name: "A", week_number: 1, role: "primary_compound",
        slot_group: "primary_compound|squat|quads" },
      { exercise_id: "ex-w", exercise_name: "W", week_number: 1, role: "warm_up",
        slot_group: "warm_up|push|chest" },
    ])
    expect(ctx.excluded_exercise_ids.has("ex-a")).toBe(true)
    expect(ctx.excluded_exercise_ids.has("ex-w")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd functions && npm test -- dedup-verify`
Expected: FAIL — `excluded_exercise_ids` does not exist on `PriorWeekContext`.

- [ ] **Step 3: Add `excluded_exercise_ids` to the context type and populate it**

Edit `functions/src/ai/dedup-verify.ts`. Update the `PriorWeekContext` interface:

```typescript
export interface PriorWeekContext {
  anchor_exercises: Map<string, string>
  used_accessory_exercises: Map<string, Set<string>>
  exercise_week_map: Map<string, number[]>
  /** Flat set of exercise IDs in variety (non-anchor) roles — for hard candidate pruning. */
  excluded_exercise_ids: Set<string>
  prompt_text: string
}
```

In `buildPriorContextFromExistingExercises`, just before the return, add:

```typescript
  const excluded_exercise_ids = new Set<string>()
  for (const idSet of used_accessory_exercises.values()) {
    for (const id of idSet) excluded_exercise_ids.add(id)
  }
```

Add `excluded_exercise_ids` to the returned object.

In `buildPriorWeekContext` (the skeleton-based variant lower in the file), add the same logic just before its return. Both functions return the same `PriorWeekContext` shape.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd functions && npm test -- dedup-verify`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/dedup-verify.ts functions/src/ai/__tests__/dedup-verify.test.ts
git commit -m "feat(ai): expose excluded_exercise_ids set on PriorWeekContext"
```

---

## Wave 2 — Wiring (2 tasks, sequential)

### Task 5: Shared helpers — `buildExcludeIdSet` + `slot_role` write

**Files:**
- Modify: `functions/src/ai/shared-helpers.ts`
- Create: `functions/src/ai/__tests__/shared-helpers.test.ts`

**Depends on:** Task 1 (slot_role column), Task 4 (excluded_exercise_ids on context)

- [ ] **Step 1: Write failing tests**

Create `functions/src/ai/__tests__/shared-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { buildExcludeIdSet, buildExerciseRows, buildSlotLookups } from "../shared-helpers.js"
import type { PriorWeekContext } from "../dedup-verify.js"
import type { ProgramWeek } from "../types.js"

function ctxWith(rolesToIds: Record<string, string[]>): PriorWeekContext {
  const used = new Map<string, Set<string>>()
  const exerciseWeekMap = new Map<string, number[]>()
  const excluded = new Set<string>()
  for (const [groupKey, ids] of Object.entries(rolesToIds)) {
    used.set(groupKey, new Set(ids))
    for (const id of ids) {
      exerciseWeekMap.set(id, [1])
      excluded.add(id)
    }
  }
  return {
    anchor_exercises: new Map(),
    used_accessory_exercises: used,
    exercise_week_map: exerciseWeekMap,
    excluded_exercise_ids: excluded,
    prompt_text: "",
  }
}

describe("buildExcludeIdSet", () => {
  it("returns excluded ids matching the requested roles", () => {
    const ctx = ctxWith({
      "primary_compound|squat|quads": ["ex-1", "ex-2"],
      "isolation|rotation|obliques": ["ex-3"],
    })
    const out = buildExcludeIdSet(ctx, new Set(["primary_compound", "secondary_compound", "accessory", "isolation"]))
    expect(out.has("ex-1")).toBe(true)
    expect(out.has("ex-2")).toBe(true)
    expect(out.has("ex-3")).toBe(true)
  })

  it("returns empty set when no roles match", () => {
    const ctx = ctxWith({ "primary_compound|squat|quads": ["ex-1"] })
    const out = buildExcludeIdSet(ctx, new Set(["warm_up"]))
    expect(out.size).toBe(0)
  })
})

describe("buildExerciseRows persists slot_role", () => {
  it("writes slot_role from slotDetailsLookup into output rows", () => {
    const weeks: ProgramWeek[] = [{
      week_number: 1, phase: "x", intensity_modifier: "moderate",
      days: [{ day_of_week: 1, label: "L", focus: "f", slots: [{
        slot_id: "w1d1s1", role: "primary_compound", movement_pattern: "squat",
        target_muscles: ["quads"], sets: 3, reps: "5", rest_seconds: 120,
        rpe_target: 8, tempo: null, group_tag: null, technique: "straight_set",
        intensity_pct: null,
      }] }],
    }]
    const { slotLookup, slotDetailsLookup } = buildSlotLookups(weeks)
    const rows = buildExerciseRows(
      [{ slot_id: "w1d1s1", exercise_id: "ex-1", notes: null }],
      slotLookup, slotDetailsLookup, "prog-1",
    )
    expect(rows[0].slot_role).toBe("primary_compound")
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd functions && npm test -- shared-helpers`
Expected: FAIL — `buildExcludeIdSet is not exported`; `slot_role` not on output rows.

- [ ] **Step 3: Implement `buildExcludeIdSet` and persist slot_role**

Edit `functions/src/ai/shared-helpers.ts`. After the existing exports, add:

```typescript
import type { PriorWeekContext } from "./dedup-verify.js"

/**
 * Compute the exercise IDs to physically remove from the candidate library
 * for a generation. Filters the context's excluded set down to variety roles
 * actually being generated. Anchor roles (warm_up/cool_down) are never excluded.
 */
export function buildExcludeIdSet(
  priorContext: PriorWeekContext,
  slotRolesInScope: Set<string>,
): Set<string> {
  const out = new Set<string>()
  for (const [groupKey, ids] of priorContext.used_accessory_exercises) {
    const role = groupKey.split("|")[0]
    if (!slotRolesInScope.has(role)) continue
    for (const id of ids) out.add(id)
  }
  return out
}
```

Update `SlotDetails` to include role:

```typescript
interface SlotDetails {
  sets: number
  reps: string
  rest_seconds: number
  rpe_target: number | null
  tempo: string | null
  group_tag: string | null
  technique: ExerciseSlot["technique"]
  role: ExerciseSlot["role"]
}
```

Update `buildSlotLookups` to capture `role`:

```typescript
        slotDetailsLookup.set(slot.slot_id, {
          sets: slot.sets,
          reps: slot.reps,
          rest_seconds: slot.rest_seconds,
          rpe_target: slot.rpe_target,
          tempo: slot.tempo,
          group_tag: slot.group_tag,
          technique: slot.technique ?? "straight_set",
          role: slot.role,
        })
```

Update `buildExerciseRows` to include `slot_role` in the returned object:

```typescript
        return {
          program_id: programId,
          exercise_id: assigned.exercise_id,
          day_of_week: location.day_of_week,
          week_number: location.week_number,
          order_index: location.order_index,
          sets: details.sets,
          reps: details.reps,
          duration_seconds: null,
          rest_seconds: details.rest_seconds,
          notes: assigned.notes,
          rpe_target: details.rpe_target,
          intensity_pct: null,
          tempo: details.tempo,
          group_tag: details.group_tag,
          technique: VALID_TECHNIQUES.has(details.technique ?? "") ? details.technique : "straight_set",
          slot_role: details.role,
        }
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd functions && npm test -- shared-helpers`
Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/shared-helpers.ts functions/src/ai/__tests__/shared-helpers.test.ts
git commit -m "feat(ai): add buildExcludeIdSet helper; persist slot_role on exercise rows"
```

---

### Task 6: Week orchestrator — wire the new pieces

**Files:**
- Modify: `functions/src/ai/week-orchestrator.ts`

**Depends on:** Tasks 2, 3, 4, 5.

- [ ] **Step 1: Add new imports at the top of the file**

Edit `functions/src/ai/week-orchestrator.ts`. Update the imports:

```typescript
import { callAgent, MODEL_OPUS, MODEL_SONNET } from "./anthropic.js"
import { scoreAndFilterExercises, semanticFilterExercises, filterByInjuredJoints } from "./exercise-filter.js"
import { profileAnalysisSchema, programSkeletonSchema, exerciseAssignmentSchema } from "./schemas.js"
import { EXERCISE_SELECTOR_PROMPT, WEEK_PROFILE_ANALYZER_PROMPT } from "./prompts.js"
import { validateProgram } from "./validate.js"
import { formatExerciseLibrary, filterByDifficultyLevel, filterByProgressionPhase } from "./exercise-context.js"
import { getExercisesForAI } from "./program-chat-tools.js"
import { buildPriorContextFromExistingExercises, verifyWeekAgainstExisting } from "./dedup-verify.js"
import { getCoachPolicyFromFn, formatCoachPolicyAsInstructions } from "./coach-policy.js"
import { getCoachRecentUsageFromFn, getClientRecentUsageFromFn, recordUsageFromFn } from "./usage-history.js"
import { getSupabase } from "../lib/supabase.js"
import {
  getProgramById,
  getClientProfile,
  getClientName,
  bulkAddExercisesToProgram,
  extractInjuredJoints,
  buildCoachInstructionsSection,
  buildPoolNote,
  applyPoolFilter,
  createJobProgressUpdater,
  createCancellationChecker,
  buildSlotLookups,
  buildExerciseRows,
  buildExcludeIdSet,
} from "./shared-helpers.js"
import type { ProfileAnalysis } from "./types.js"
import { z } from "zod"
```

- [ ] **Step 2: Fetch coach policy and usage history alongside other parallel fetches**

Locate the existing `Promise.all` block (currently `getProgramById`, `getProgramExercises`, `getExercisesForAI`). Replace it with:

```typescript
  const [program, existingExercises, fullLibrary, coachPolicy, coachUsage, clientUsage] = await Promise.all([
    getProgramById(request.program_id),
    getProgramExercises(request.program_id),
    getExercisesForAI(),
    getCoachPolicyFromFn(requestedBy).catch((e) => {
      console.warn("[week-orchestrator] coach policy fetch failed:", e instanceof Error ? e.message : e)
      return null
    }),
    getCoachRecentUsageFromFn(requestedBy, 60).catch(() => new Map<string, number>()),
    request.client_id
      ? getClientRecentUsageFromFn(request.client_id, 90).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
  ])
  console.log(
    `[week-orchestrator] policy: ${coachPolicy ? "loaded" : "none"}, coach usage: ${coachUsage.size}, client usage: ${clientUsage.size}`,
  )
```

- [ ] **Step 3: Replace the `mockAnalysis` block with a real Agent 1 call**

Find the block beginning `// Build a mock ProfileAnalysis for filtering` (around line 551) and ending at the close of `mockAnalysis` (around line 585). Replace the entire block with:

```typescript
  // ── Step 2.5: Real Agent 1 (Profile Analyzer, week-scoped) ───────────────
  const policyInstructions = formatCoachPolicyAsInstructions(coachPolicy)
  const combinedInstructions = [request.admin_instructions, policyInstructions].filter(Boolean).join("\n\n")
  const coachInstructionsSection = buildCoachInstructionsSection(combinedInstructions)

  const analyzerMessage = `## Client Profile
${profileContext}

## Program Summary
${JSON.stringify(programSummary)}

## Prior Weeks Focus Summary
${weekFocusSummary.length > 0 ? JSON.stringify(weekFocusSummary) : "No prior weeks."}

## Target Week
${newWeekNumber}${coachInstructionsSection}

Output the JSON for this single target week. technique_plan and difficulty_ceiling MUST contain exactly one entry with week_number=${newWeekNumber}.`

  let analysis: ProfileAnalysis
  try {
    const analyzerResult = await callAgent<ProfileAnalysis>(
      WEEK_PROFILE_ANALYZER_PROMPT,
      analyzerMessage,
      profileAnalysisSchema,
      { model: MODEL_SONNET, cacheSystemPrompt: true },
    )
    tokenUsage.architect += analyzerResult.tokens_used // reuse architect bucket; no schema change
    analysis = analyzerResult.content
    // Ensure the single entries actually match the target week.
    if (analysis.technique_plan[0]) analysis.technique_plan[0].week_number = newWeekNumber
    if (analysis.difficulty_ceiling[0]) analysis.difficulty_ceiling[0].week_number = newWeekNumber
    console.log(
      `[week-orchestrator] Agent 1 (week-scoped) — techniques: ${analysis.technique_plan[0]?.allowed_techniques.join(",")}; ceiling: ${analysis.difficulty_ceiling[0]?.max_tier}/${analysis.difficulty_ceiling[0]?.max_score}`,
    )
  } catch (e) {
    console.warn(
      `[week-orchestrator] Agent 1 failed, falling back to mock analysis: ${e instanceof Error ? e.message : e}`,
    )
    analysis = {
      recommended_split: program.split_type,
      recommended_periodization: program.periodization,
      volume_targets: [{ muscle_group: "full_body", sets_per_week: 12, priority: "medium" }],
      exercise_constraints: [],
      session_structure: {
        warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5,
        total_exercises: 6, compound_count: 3, isolation_count: 3,
      },
      training_age_category: clientDifficultyLevel as ProfileAnalysis["training_age_category"],
      technique_plan: [{
        week_number: newWeekNumber,
        allowed_techniques: ["straight_set"],
        default_technique: "straight_set",
        notes: "fallback",
      }],
      difficulty_ceiling: [{
        week_number: newWeekNumber,
        max_tier: ceilingTier,
        max_score: ceilingScore,
      }],
      notes: "fallback",
    } as ProfileAnalysis
  }
```

(Remove the now-unused `mockAnalysis` variable. The variable referenced as `mockAnalysis` in the filter call needs to be renamed to `analysis` — see Step 5.)

- [ ] **Step 4: Build `excludeIds` and pass it (plus usage maps and MMR) to the filter**

Locate the existing prior-context build (the section around line 617–635 starting with `const priorExercisesForDedup`). Immediately after `priorContext = buildPriorContextFromExistingExercises(...)`, add:

```typescript
  const VARIETY_ROLES = new Set<string>([
    "primary_compound", "secondary_compound", "accessory", "isolation",
    "power", "conditioning", "activation", "testing",
  ])
  const excludeIds = buildExcludeIdSet(priorContext, VARIETY_ROLES)
  console.log(`[week-orchestrator] excludeIds: ${excludeIds.size} ids hard-pruned from candidate library`)
```

- [ ] **Step 5: Update the filter call**

Find the existing filter block:

```typescript
  let filtered: CompressedExercise[]
  try {
    filtered = await semanticFilterExercises(exercisesForSelection, skeleton, availableEquipment, mockAnalysis, {
      poolActive,
    })
  } catch {
    filtered = scoreAndFilterExercises(exercisesForSelection, skeleton, availableEquipment, mockAnalysis, {
      poolActive,
    })
  }
```

Replace with:

```typescript
  let filtered: CompressedExercise[]
  try {
    filtered = await semanticFilterExercises(exercisesForSelection, skeleton, availableEquipment, analysis, {
      poolActive,
      coachUsage,
      clientUsage,
      excludeIds,
      mmrLambda: 0.7,
    })
  } catch {
    filtered = scoreAndFilterExercises(exercisesForSelection, skeleton, availableEquipment, analysis, {
      poolActive,
      coachUsage,
      clientUsage,
      excludeIds,
      mmrLambda: 0.7,
    })
  }
```

- [ ] **Step 6: After save, record usage (fire-and-forget)**

Locate the section after `bulkAddExercisesToProgram(exerciseRows)`. Immediately after that call (and before the `if (!isFillingBlank && !isSingleDay)` block that updates duration), add:

```typescript
  // Fire-and-forget usage recording — never blocks response
  if (request.client_id !== undefined) {
    const usageRows = assignment.assignments
      .map((a) => {
        const loc = slotLookup.get(a.slot_id)
        if (!loc) return null
        return {
          exercise_id: a.exercise_id,
          week_number: loc.week_number,
          day_number: loc.day_of_week,
        }
      })
      .filter((r): r is { exercise_id: string; week_number: number; day_number: number } => r !== null)
    recordUsageFromFn({
      coach_id: requestedBy,
      client_id: request.client_id ?? null,
      program_id: request.program_id,
      rows: usageRows,
    }).catch((e) =>
      console.warn("[week-orchestrator] recordUsage failed (non-blocking):", e instanceof Error ? e.message : e),
    )
  }
```

- [ ] **Step 7: Update slot-role inference fallback to prefer DB column**

Find the block `const priorExercisesForDedup = existingExercises.map(...)`. Update the role inference to prefer the new `slot_role` column when present:

```typescript
  const priorExercisesForDedup = existingExercises.map((pe: Record<string, unknown>) => {
    const ex = pe.exercises as { name?: string; movement_pattern?: string; primary_muscles?: string[] } | undefined
    const orderIdx = pe.order_index as number
    // Prefer DB-stored slot_role; fall back to inference for legacy rows.
    let inferredRole = (pe.slot_role as string | null) ?? null
    if (!inferredRole) {
      if (orderIdx === 0) inferredRole = "warm_up"
      else if (orderIdx <= 2) inferredRole = "primary_compound"
      else inferredRole = "accessory"
    }
    const slotGroup = `${inferredRole}|${ex?.movement_pattern ?? "unknown"}|${(ex?.primary_muscles ?? []).sort().join(",")}`
    return {
      exercise_id: pe.exercise_id as string,
      exercise_name: ex?.name ?? "Unknown",
      week_number: pe.week_number as number,
      role: inferredRole,
      slot_group: slotGroup,
    }
  })
```

Also extend `getProgramExercises` (in the same file) to select `slot_role`:

```typescript
async function getProgramExercises(programId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("program_exercises")
    .select("*, exercises(name, movement_pattern, primary_muscles, equipment_required)")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_of_week", { ascending: true })
    .order("order_index", { ascending: true })
  if (error) throw new Error(`Failed to fetch program exercises: ${error.message}`)
  return data ?? []
}
```

The `*` already covers `slot_role`; nothing to change here, but verify by reading the function — confirm `select("*, ...")` is in place.

- [ ] **Step 8: Build & typecheck**

Run: `cd functions && npm run build`
Expected: PASS — no type errors. Resolve any complaints (most likely: an unused variable `mockAnalysis` if it wasn't fully removed, or a missing import).

- [ ] **Step 9: Run all AI tests to confirm no regression**

Run: `cd functions && npm test`
Expected: PASS — all existing tests green; new tests from Tasks 2, 4, 5 also green.

- [ ] **Step 10: Commit**

```bash
git add functions/src/ai/week-orchestrator.ts
git commit -m "feat(ai): wire week-orchestrator to coach policy, usage history, real Agent 1, hard-prune, MMR"
```

---

## Wave 3 — Verification (1 task)

### Task 7: Integration smoke test for week-orchestrator

**Files:**
- Create: `functions/src/ai/__tests__/week-orchestrator.test.ts`

**Depends on:** Task 6.

This is a mock-heavy integration test confirming the wiring. We do not call live Anthropic; we mock `callAgent` and verify the pipeline shape and side effects.

- [ ] **Step 1: Write the test**

Create `functions/src/ai/__tests__/week-orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

// Hoisted mocks ensure they apply before module imports
const callAgentMock = vi.hoisted(() => vi.fn())
const recordUsageMock = vi.hoisted(() => vi.fn(async () => undefined))
const getCoachPolicyMock = vi.hoisted(() => vi.fn(async () => null))
const getCoachUsageMock = vi.hoisted(() => vi.fn(async () => new Map()))
const getClientUsageMock = vi.hoisted(() => vi.fn(async () => new Map()))

vi.mock("../anthropic.js", async () => {
  const actual = await vi.importActual<typeof import("../anthropic.js")>("../anthropic.js")
  return { ...actual, callAgent: callAgentMock }
})
vi.mock("../usage-history.js", () => ({
  recordUsageFromFn: recordUsageMock,
  getCoachRecentUsageFromFn: getCoachUsageMock,
  getClientRecentUsageFromFn: getClientUsageMock,
}))
vi.mock("../coach-policy.js", () => ({
  getCoachPolicyFromFn: getCoachPolicyMock,
  formatCoachPolicyAsInstructions: () => "",
}))
// Stub out Supabase calls used by the orchestrator
vi.mock("../lib/supabase.js", () => {
  const mockSelect = vi.fn().mockReturnThis()
  const mockEq = vi.fn().mockReturnThis()
  const mockOrder = vi.fn().mockReturnThis()
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "prog-1", split_type: "full_body", periodization: "linear", duration_weeks: 4, sessions_per_week: 3 }, error: null })
  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnThis()
  return {
    getSupabase: () => ({
      from: () => ({ select: mockSelect, eq: mockEq, order: mockOrder, single: mockSingle, insert: mockInsert, update: mockUpdate, in: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }
})

describe("generateWeekSync wiring", () => {
  beforeEach(() => {
    callAgentMock.mockReset()
    recordUsageMock.mockReset()
    getCoachPolicyMock.mockClear()
    getCoachUsageMock.mockClear()
    getClientUsageMock.mockClear()
  })

  it("fetches coach policy and usage history before generating", async () => {
    // Agent 1 → analysis, Agent 2 → skeleton, Agent 3 → assignments
    callAgentMock
      .mockResolvedValueOnce({ content: { recommended_split: "full_body", recommended_periodization: "linear", volume_targets: [{ muscle_group: "x", sets_per_week: 10, priority: "medium" }], exercise_constraints: [], session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5, total_exercises: 4, compound_count: 2, isolation_count: 2 }, training_age_category: "intermediate", technique_plan: [{ week_number: 5, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" }], difficulty_ceiling: [{ week_number: 5, max_tier: "intermediate", max_score: 6 }], notes: "" }, tokens_used: 100 })
      .mockResolvedValueOnce({ content: { weeks: [{ week_number: 5, phase: "x", intensity_modifier: "moderate", days: [{ day_of_week: 1, label: "L", focus: "f", slots: [{ slot_id: "w5d1s1", role: "primary_compound", movement_pattern: "squat", target_muscles: ["quads"], sets: 3, reps: "8", rest_seconds: 90, rpe_target: 7, tempo: null, group_tag: null, technique: "straight_set", intensity_pct: null }] }] }], split_type: "full_body", periodization: "linear", total_sessions: 1, notes: "" }, tokens_used: 200 })
      .mockResolvedValueOnce({ content: { assignments: [{ slot_id: "w5d1s1", exercise_id: "ex-1", exercise_name: "Squat", notes: null }], substitution_notes: [] }, tokens_used: 50 })

    const { generateWeekSync } = await import("../week-orchestrator.js")
    await generateWeekSync(
      { program_id: "prog-1", client_id: "client-1" },
      "coach-1",
    ).catch(() => null) // ignore downstream Supabase failures; we're checking pre-generate fetches

    expect(getCoachPolicyMock).toHaveBeenCalledWith("coach-1")
    expect(getCoachUsageMock).toHaveBeenCalledWith("coach-1", 60)
    expect(getClientUsageMock).toHaveBeenCalledWith("client-1", 90)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd functions && npm test -- week-orchestrator`
Expected: PASS. The test verifies the new fetch wiring; full end-to-end behavior is exercised by the other unit tests in this plan and by manual smoke testing.

If the test fails because of additional Supabase calls not stubbed in the mock, expand the mock to cover them. Do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add functions/src/ai/__tests__/week-orchestrator.test.ts
git commit -m "test(ai): smoke test for week-orchestrator coach policy + usage wiring"
```

---

## Manual smoke verification (post-merge)

After all tasks ship, perform a manual end-to-end check before declaring done:

- [ ] **Step 1:** In the admin UI, generate a new week for a real client whose program already has 4 weeks of exercises. Watch the Firebase function logs for:
  - `policy: loaded|none, coach usage: <n>, client usage: <n>`
  - `Agent 1 (week-scoped) — techniques: …; ceiling: …`
  - `excludeIds: <n> ids hard-pruned from candidate library`
  - `recordUsage` log line on success.

- [ ] **Step 2:** Inspect the new week's exercises in the admin UI. Confirm ≥ 80% are different exercise IDs from prior weeks (eyeball or query `program_exercises` directly).

- [ ] **Step 3:** Query `generated_exercise_usage` to confirm rows were written for this generation:

```sql
SELECT COUNT(*), MIN(assigned_at), MAX(assigned_at)
FROM generated_exercise_usage
WHERE program_id = '<program_id>';
```

- [ ] **Step 4:** Set a coach AI policy with `disallowed_techniques: ["superset"]`, generate a week, and confirm no superset technique appears in the new week's exercises.

---

## Self-Review

**Spec coverage:**
- Root cause 1 (cross-program memory loss) → Tasks 6 (read), 6 (write).
- Root cause 2 (AVOID list as prose) → Task 4 (excluded_exercise_ids), 5 (buildExcludeIdSet), 6 (wired to filter).
- Root cause 3 (no real Agent 1) → Tasks 3 (prompt), 6 (wired).
- Root cause 4 (crude slot-role inference) → Tasks 1 (column + backfill), 5 (write path), 6 (read path with fallback).
- Root cause 5 (same top scorers always win) → Task 2 (MMR).
- Root cause 6 (coach policy ignored) → Task 6 (fetched + injected via `formatCoachPolicyAsInstructions`).
- Storage upgrade (`slot_role`) → Task 1.
- Backward compat — confirmed: `excludeIds`, `mmrLambda` are optional; full-program orchestrator continues to work without changes (and gets the upgrades for free if it later passes the new options).

**Placeholder scan:** No TBDs, no "fill in", no "similar to Task N". Every code step has the actual code.

**Type consistency:**
- `PriorWeekContext.excluded_exercise_ids` defined in Task 4, consumed in Task 5.
- `FilterOptions.excludeIds` and `mmrLambda` defined in Task 2, consumed in Task 6.
- `buildExcludeIdSet` signature matches between Task 5 (definition) and Task 6 (call site).
- `slot_role` column added in Task 1, written in Task 5, read in Task 6 — all spelled identically.

No fixes needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-ai-week-day-variety.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for high-confidence merging directly to main.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
