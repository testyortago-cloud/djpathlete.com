# AI Program Generation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate four recurring quality issues in AI-generated programs — beginners getting too-hard exercises, within-program repetition, cross-client repetition, and superset monotony — by enforcing constraints at the prompt, schema, data, and selection layers.

**Architecture:** Same 4-agent pipeline in `functions/src/ai/` reinforced at four layers: (1) prompts rewritten so Agent 1 emits `technique_plan` and `difficulty_ceiling` per week that Agent 2 and Agent 3 must honor; (2) Zod schemas reject violations and trigger retry; (3) new Supabase tables `generated_exercise_usage` (append-only log of every exercise ever assigned) and `coach_ai_policy` (per-coach overrides); (4) `semanticFilterExercises` reads usage history and down-ranks recently-used exercises.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Firebase Cloud Functions (TypeScript), Supabase PostgreSQL, Zod, `@ai-sdk/anthropic`, Vitest + Testing Library + Playwright.

**Reference spec:** `docs/superpowers/specs/2026-04-14-ai-generation-improvements-design.md`

---

## Parallel Execution Plan

Tasks can be dispatched in waves:

- **Wave 1 (parallel):** Task 1, Task 2, Task 3, Task 4 (no inter-task deps)
- **Wave 2 (parallel, after Wave 1):** Task 5, Task 6 (Task 5 depends on Task 1 migration; Task 6 depends on Tasks 2, 3, 4)
- **Wave 3 (parallel, after Wave 2):** Task 7 (depends on Tasks 5, 6), Task 8 (depends on Task 5)
- **Wave 4 (sequential, after Wave 3):** Task 9 (end-to-end integration tests, depends on everything)

---

## Task 1: Database migration for exercise usage tracking and coach AI policy

**Files:**
- Create: `supabase/migrations/00061_exercise_usage_and_coach_policy.sql`
- Create: `__tests__/migrations/00061.test.ts` (schema validation test)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/00061_exercise_usage_and_coach_policy.sql`:

```sql
-- Migration 00061: Exercise usage tracking + coach AI policy
-- Adds data layer for cross-client and per-client exercise variety,
-- and per-coach technique/policy overrides for AI generation.

-- ─── Exercise usage tracking ──────────────────────────────────────────────
-- Append-only log of every exercise assigned in a successful AI-generated program.
-- Queried by the AI semantic filter to down-rank recently-used exercises.

CREATE TABLE IF NOT EXISTS generated_exercise_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES users(id) ON DELETE SET NULL,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  day_number INT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geu_coach_assigned
  ON generated_exercise_usage (coach_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_geu_client_assigned
  ON generated_exercise_usage (client_id, assigned_at DESC)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geu_exercise_assigned
  ON generated_exercise_usage (exercise_id, assigned_at DESC);

-- ─── Coach AI policy ──────────────────────────────────────────────────────
-- Per-coach policy overrides. Injected into Agent 1 prompt as augmented
-- COACH INSTRUCTIONS so the AI respects studio-wide preferences.

CREATE TABLE IF NOT EXISTS coach_ai_policy (
  coach_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  disallowed_techniques JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_techniques JSONB NOT NULL DEFAULT '[]'::jsonb,
  technique_progression_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  programming_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure techniques listed are from the known enum
ALTER TABLE coach_ai_policy ADD CONSTRAINT coach_ai_policy_disallowed_valid
  CHECK (
    jsonb_typeof(disallowed_techniques) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(disallowed_techniques) AS t
      WHERE t NOT IN (
        'straight_set','superset','dropset','giant_set','circuit',
        'rest_pause','amrap','cluster_set','complex','emom','wave_loading'
      )
    )
  );

ALTER TABLE coach_ai_policy ADD CONSTRAINT coach_ai_policy_preferred_valid
  CHECK (
    jsonb_typeof(preferred_techniques) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(preferred_techniques) AS t
      WHERE t NOT IN (
        'straight_set','superset','dropset','giant_set','circuit',
        'rest_pause','amrap','cluster_set','complex','emom','wave_loading'
      )
    )
  );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION set_coach_ai_policy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coach_ai_policy_updated_at ON coach_ai_policy;
CREATE TRIGGER trg_coach_ai_policy_updated_at
  BEFORE UPDATE ON coach_ai_policy
  FOR EACH ROW EXECUTE FUNCTION set_coach_ai_policy_updated_at();
```

- [ ] **Step 2: Apply migration to local dev database**

Run: `npx supabase db reset` (if using local Supabase) OR apply via Supabase dashboard SQL editor.

Expected: Migration applies with no errors. Tables `generated_exercise_usage` and `coach_ai_policy` exist.

Verify:
```bash
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('generated_exercise_usage','coach_ai_policy');"
```
Expected output: Both table names listed.

- [ ] **Step 3: Write schema-validation test**

Create `__tests__/migrations/00061.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("Migration 00061: exercise usage + coach policy", () => {
  const supabase = createServiceRoleClient()

  it("generated_exercise_usage table exists with required columns", async () => {
    const { data, error } = await supabase
      .from("generated_exercise_usage")
      .select("id,coach_id,client_id,exercise_id,program_id,week_number,day_number,assigned_at")
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("coach_ai_policy table exists with required columns and defaults", async () => {
    const { data, error } = await supabase
      .from("coach_ai_policy")
      .select("coach_id,disallowed_techniques,preferred_techniques,technique_progression_enabled,programming_notes,updated_at")
      .limit(0)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("rejects coach_ai_policy rows with invalid technique in disallowed_techniques", async () => {
    const { error } = await supabase
      .from("coach_ai_policy")
      .insert({
        coach_id: "00000000-0000-0000-0000-000000000001",
        disallowed_techniques: ["not_a_real_technique"],
      })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/)
  })
})
```

- [ ] **Step 4: Run migration test**

Run: `npm run test:run -- __tests__/migrations/00061.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00061_exercise_usage_and_coach_policy.sql __tests__/migrations/00061.test.ts
git commit -m "Add migration 00061: exercise usage tracking and coach AI policy tables"
```

---

## Task 2: Hard-exclusion difficulty filter with earned progression

**Files:**
- Modify: `functions/src/ai/exercise-context.ts`
- Create: `functions/src/ai/__tests__/exercise-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `functions/src/ai/__tests__/exercise-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  filterByDifficultyLevel,
  filterByProgressionPhase,
} from "../exercise-context.js"
import type { CompressedExercise } from "../types.js"

const mk = (id: string, difficulty: string, score: number | null = null): CompressedExercise => ({
  id,
  name: `ex-${id}`,
  difficulty,
  difficulty_score: score,
  movement_pattern: "push",
  primary_muscles: ["chest"],
  secondary_muscles: [],
  equipment_required: [],
  is_bodyweight: false,
  training_intent: ["build"],
  sport_tags: [],
  joints_loaded: [],
  plane_of_motion: ["sagittal"],
} as unknown as CompressedExercise)

describe("filterByDifficultyLevel — hard exclusion", () => {
  const exercises = [
    mk("b1", "beginner"), mk("b2", "beginner"),
    mk("i1", "intermediate"), mk("i2", "intermediate"),
    mk("a1", "advanced"), mk("a2", "advanced"),
  ]

  it("beginner clients get ONLY beginner exercises (no intermediates)", () => {
    const result = filterByDifficultyLevel(exercises, "beginner")
    expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
  })

  it("intermediate clients get beginner + intermediate, no advanced", () => {
    const result = filterByDifficultyLevel(exercises, "intermediate")
    expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i1", "i2"])
  })

  it("advanced clients get all exercises", () => {
    const result = filterByDifficultyLevel(exercises, "advanced")
    expect(result.map((e) => e.id).sort()).toEqual(["a1", "a2", "b1", "b2", "i1", "i2"])
  })

  it("unknown difficulty level returns all exercises (graceful degradation)", () => {
    const result = filterByDifficultyLevel(exercises, "somethingWeird")
    expect(result).toHaveLength(6)
  })

  it("exercise with unknown difficulty is included (never strip unknowns)", () => {
    const weird = [...exercises, mk("unknown", "mystery")]
    const result = filterByDifficultyLevel(weird, "beginner")
    expect(result.map((e) => e.id)).toContain("unknown")
  })
})

describe("filterByProgressionPhase — earned progression", () => {
  const exercises = [
    mk("b1", "beginner", 2), mk("b2", "beginner", 3),
    mk("i_easy", "intermediate", 4),  // low-score intermediate, eligible in later weeks
    mk("i_hard", "intermediate", 7),  // high-score intermediate, never eligible for beginner
    mk("a1", "advanced", 8),
  ]

  describe("beginner client", () => {
    it("week 1: only beginner exercises", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 1)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
    })

    it("week 2: still only beginner", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 2)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2"])
    })

    it("week 3+: beginner + intermediate with score <= 4", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 3)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy"])
    })

    it("week 3+: advanced exercises NEVER allowed for beginners", () => {
      const result = filterByProgressionPhase(exercises, "beginner", 4)
      expect(result.map((e) => e.id)).not.toContain("a1")
    })
  })

  describe("intermediate client", () => {
    it("week 1: beginner + intermediate, no advanced", () => {
      const result = filterByProgressionPhase(exercises, "intermediate", 1)
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy", "i_hard"])
    })

    it("week 3+: beginner + intermediate + advanced with score <= 4 (none in this set)", () => {
      const result = filterByProgressionPhase(exercises, "intermediate", 3)
      // Advanced score 8 is not <= 4, so stays excluded
      expect(result.map((e) => e.id).sort()).toEqual(["b1", "b2", "i_easy", "i_hard"])
    })
  })

  describe("advanced/elite client", () => {
    it("all weeks: all exercises", () => {
      const result = filterByProgressionPhase(exercises, "advanced", 1)
      expect(result).toHaveLength(5)
    })
    it("elite treated like advanced", () => {
      const result = filterByProgressionPhase(exercises, "elite", 1)
      expect(result).toHaveLength(5)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run src/ai/__tests__/exercise-context.test.ts`
Expected: All 11+ test cases FAIL — `filterByDifficultyLevel` currently permits one level up, and `filterByProgressionPhase` doesn't exist.

- [ ] **Step 3: Rewrite `filterByDifficultyLevel` and add `filterByProgressionPhase`**

Replace the entire contents of `functions/src/ai/exercise-context.ts` with:

```typescript
import type { CompressedExercise } from "./types.js"

const DIFFICULTY_LEVELS = ["beginner", "intermediate", "advanced"] as const
type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number]

/** Threshold (inclusive) below which a higher-tier exercise becomes eligible in later weeks. */
const EARNED_PROGRESSION_SCORE_CAP = 4

/** Week number at which earned progression unlocks low-score higher-tier exercises. */
const EARNED_PROGRESSION_START_WEEK = 3

/**
 * Filter compressed exercises by max numeric difficulty score (from assessment).
 * Exercises without a score are always included.
 */
export function filterByDifficultyScore(
  exercises: CompressedExercise[],
  maxDifficultyScore?: number
): CompressedExercise[] {
  if (maxDifficultyScore === undefined) return exercises
  return exercises.filter((ex) => {
    if (ex.difficulty_score === null || ex.difficulty_score === undefined) return true
    return ex.difficulty_score <= maxDifficultyScore
  })
}

/**
 * Hard-exclusion difficulty filter.
 * - beginner clients:    ONLY beginner exercises
 * - intermediate clients: beginner + intermediate
 * - advanced/elite:      all exercises
 * - unknown difficulty level: no filtering (graceful)
 * - exercise with unknown difficulty: always included
 */
export function filterByDifficultyLevel(
  exercises: CompressedExercise[],
  clientDifficulty: string
): CompressedExercise[] {
  const clientIdx = DIFFICULTY_LEVELS.indexOf(clientDifficulty as DifficultyLevel)
  if (clientIdx === -1) return exercises
  return exercises.filter((ex) => {
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as DifficultyLevel)
    if (exIdx === -1) return true
    return exIdx <= clientIdx
  })
}

/**
 * Earned-progression filter layered on top of experience-level filtering.
 *
 * Base rule matches filterByDifficultyLevel. Additionally, from
 * EARNED_PROGRESSION_START_WEEK onward, low-score (<= EARNED_PROGRESSION_SCORE_CAP)
 * exercises from ONE tier above the client's level become eligible.
 *
 * - beginner, weeks 1-2: only beginner exercises.
 * - beginner, week 3+:   beginner + intermediate with score <= 4. Advanced NEVER.
 * - intermediate, weeks 1-2: beginner + intermediate.
 * - intermediate, week 3+:   + advanced with score <= 4.
 * - advanced/elite: no restrictions at any week.
 *
 * Exercises without a difficulty_score are treated conservatively: they are
 * included only if their tier is already in-bounds (not via progression).
 */
export function filterByProgressionPhase(
  exercises: CompressedExercise[],
  clientDifficulty: string,
  weekNumber: number
): CompressedExercise[] {
  const normalized = clientDifficulty === "elite" ? "advanced" : clientDifficulty
  const clientIdx = DIFFICULTY_LEVELS.indexOf(normalized as DifficultyLevel)
  if (clientIdx === -1) return exercises

  const progressionUnlocked = weekNumber >= EARNED_PROGRESSION_START_WEEK
  const progressionMaxIdx = progressionUnlocked
    ? Math.min(clientIdx + 1, DIFFICULTY_LEVELS.length - 1)
    : clientIdx

  return exercises.filter((ex) => {
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as DifficultyLevel)
    if (exIdx === -1) return true // unknown tier: always include

    // Base tier always allowed
    if (exIdx <= clientIdx) return true

    // Earned progression: one tier up, only when unlocked AND score is low enough
    if (exIdx === progressionMaxIdx && progressionUnlocked) {
      if (ex.difficulty_score === null || ex.difficulty_score === undefined) return false
      return ex.difficulty_score <= EARNED_PROGRESSION_SCORE_CAP
    }

    return false
  })
}

/** Format compressed exercises as compact JSON for inclusion in AI prompts. */
export function formatExerciseLibrary(exercises: CompressedExercise[]): string {
  return JSON.stringify(exercises, null, 0)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npx vitest run src/ai/__tests__/exercise-context.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run type check**

Run: `cd functions && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/exercise-context.ts functions/src/ai/__tests__/exercise-context.test.ts
git commit -m "Tighten difficulty filter: hard exclusion + earned progression

filterByDifficultyLevel now excludes higher tiers (beginners no longer
see intermediates). New filterByProgressionPhase lets low-score
(<=4/10) one-tier-up exercises unlock from week 3 onward — 'earned
progression'. Advanced exercises remain fully excluded for beginners."
```

---

## Task 3: Schema updates for technique_plan, difficulty_ceiling, progression_phase

**Files:**
- Modify: `functions/src/ai/schemas.ts`
- Modify: `functions/src/ai/types.ts` (add types)
- Create: `functions/src/ai/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `functions/src/ai/__tests__/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  profileAnalysisSchema,
  programSkeletonSchema,
  validateSkeletonAgainstAnalysis,
  validateAssignmentAgainstCeiling,
} from "../schemas.js"

const validAnalysisBase = {
  recommended_split: "full_body" as const,
  recommended_periodization: "linear" as const,
  volume_targets: [{ muscle_group: "quads", sets_per_week: 10, priority: "high" as const }],
  exercise_constraints: [],
  session_structure: {
    warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5,
    total_exercises: 5, compound_count: 2, isolation_count: 3,
  },
  training_age_category: "novice" as const,
  notes: "",
}

describe("profileAnalysisSchema — technique_plan and difficulty_ceiling", () => {
  it("accepts a valid analysis with technique_plan per week", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [
        { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "motor learning" },
        { week_number: 2, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      ],
      difficulty_ceiling: [
        { week_number: 1, max_tier: "beginner", max_score: 4 },
        { week_number: 2, max_tier: "beginner", max_score: 4 },
      ],
    }
    const result = profileAnalysisSchema.parse(input)
    expect(result.technique_plan).toHaveLength(2)
    expect(result.difficulty_ceiling[0].max_tier).toBe("beginner")
  })

  it("rejects technique_plan with unknown technique", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [{ week_number: 1, allowed_techniques: ["fake_technique"], default_technique: "fake_technique", notes: "" }],
      difficulty_ceiling: [{ week_number: 1, max_tier: "beginner", max_score: 4 }],
    }
    expect(() => profileAnalysisSchema.parse(input)).toThrow()
  })

  it("rejects difficulty_ceiling with unknown tier", () => {
    const input = {
      ...validAnalysisBase,
      technique_plan: [{ week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" }],
      difficulty_ceiling: [{ week_number: 1, max_tier: "godlike", max_score: 10 }],
    }
    expect(() => profileAnalysisSchema.parse(input)).toThrow()
  })
})

describe("validateSkeletonAgainstAnalysis — technique constraint enforcement", () => {
  const analysis = profileAnalysisSchema.parse({
    ...validAnalysisBase,
    technique_plan: [
      { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 2, allowed_techniques: ["straight_set", "superset"], default_technique: "straight_set", notes: "" },
    ],
    difficulty_ceiling: [
      { week_number: 1, max_tier: "beginner", max_score: 4 },
      { week_number: 2, max_tier: "beginner", max_score: 4 },
    ],
  })

  const baseSlot = {
    slot_id: "s1", role: "primary_compound" as const, movement_pattern: "squat" as const,
    target_muscles: ["quads"], sets: 3, reps: "8-10", rest_seconds: 120,
    rpe_target: null, tempo: null, group_tag: null, intensity_pct: null,
  }

  it("passes when every slot technique is in that week's allowed_techniques", () => {
    const skeleton = {
      weeks: [
        { week_number: 1, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "straight_set" as const }] }] },
        { week_number: 2, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "superset" as const }] }] },
      ],
      split_type: "full_body" as const,
      periodization: "linear" as const,
      total_sessions: 2,
      notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it("fails when a slot uses a technique NOT in that week's allowed_techniques", () => {
    const skeleton = {
      weeks: [
        { week_number: 1, phase: "A", intensity_modifier: "moderate",
          days: [{ day_of_week: 1, label: "Mon", focus: "legs",
            slots: [{ ...baseSlot, technique: "superset" as const }] }] },
      ],
      split_type: "full_body" as const,
      periodization: "linear" as const,
      total_sessions: 1,
      notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/week 1.*superset.*not allowed/i)
  })
})

describe("validateAssignmentAgainstCeiling — difficulty ceiling enforcement", () => {
  const ceiling = [
    { week_number: 1, max_tier: "beginner" as const, max_score: 4 },
    { week_number: 2, max_tier: "beginner" as const, max_score: 4 },
    { week_number: 3, max_tier: "intermediate" as const, max_score: 4 },
  ]

  const exerciseLibrary = [
    { id: "b-easy", difficulty: "beginner", difficulty_score: 2 },
    { id: "i-easy", difficulty: "intermediate", difficulty_score: 3 },
    { id: "i-hard", difficulty: "intermediate", difficulty_score: 7 },
    { id: "a-hard", difficulty: "advanced", difficulty_score: 8 },
  ]

  const slotInWeek = new Map([["s1", 1], ["s2", 2], ["s3", 3]])

  it("passes when all week 1 assignments are beginner exercises", () => {
    const assignment = { assignments: [{ slot_id: "s1", exercise_id: "b-easy", exercise_name: "b-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when a week 1 slot is assigned an intermediate exercise", () => {
    const assignment = { assignments: [{ slot_id: "s1", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/week 1.*ceiling.*beginner/i)
  })

  it("passes when week 3 (intermediate ceiling) uses a low-score intermediate", () => {
    const assignment = { assignments: [{ slot_id: "s3", exercise_id: "i-easy", exercise_name: "i-easy", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(true)
  })

  it("fails when week 3 uses a high-score intermediate exceeding max_score", () => {
    const assignment = { assignments: [{ slot_id: "s3", exercise_id: "i-hard", exercise_name: "i-hard", notes: null }], substitution_notes: [] }
    const result = validateAssignmentAgainstCeiling(assignment, ceiling, slotInWeek, exerciseLibrary)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/score.*7.*exceeds/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npx vitest run src/ai/__tests__/schemas.test.ts`
Expected: All test cases FAIL — the new fields and validators don't exist yet.

- [ ] **Step 3: Update `schemas.ts` with new fields and validators**

Replace the contents of `functions/src/ai/schemas.ts` with:

```typescript
import { z } from "zod"

// ─── Shared constants (duplicated from Next.js validators to avoid cross-project deps) ──

const SPLIT_TYPES = [
  "full_body", "upper_lower", "push_pull_legs", "push_pull",
  "body_part", "movement_pattern", "custom",
] as const

const PERIODIZATION_TYPES = [
  "linear", "undulating", "block", "reverse_linear", "none",
] as const

const MOVEMENT_PATTERNS = [
  "push", "pull", "squat", "hinge", "lunge",
  "carry", "rotation", "isometric", "locomotion", "conditioning",
] as const

const TECHNIQUES = [
  "straight_set", "superset", "dropset", "giant_set", "circuit",
  "rest_pause", "amrap", "cluster_set", "complex", "emom", "wave_loading",
] as const

const DIFFICULTY_TIERS = ["beginner", "intermediate", "advanced"] as const

// ─── Agent 1: Profile Analysis Schema ────────────────────────────────────────

const volumeTargetSchema = z.object({
  muscle_group: z.string(),
  sets_per_week: z.number(),
  priority: z.enum(["high", "medium", "low"]),
})

const exerciseConstraintSchema = z.object({
  type: z.enum([
    "avoid_movement", "avoid_equipment", "avoid_muscle",
    "limit_load", "require_unilateral",
  ]),
  value: z.string(),
  reason: z.string(),
})

const sessionStructureSchema = z.object({
  warm_up_minutes: z.number(),
  main_work_minutes: z.number(),
  cool_down_minutes: z.number(),
  total_exercises: z.number(),
  compound_count: z.number(),
  isolation_count: z.number(),
})

const techniquePlanWeekSchema = z.object({
  week_number: z.number().int().min(1),
  allowed_techniques: z.array(z.enum(TECHNIQUES)).min(1),
  default_technique: z.enum(TECHNIQUES),
  notes: z.string().default(""),
})

const difficultyCeilingWeekSchema = z.object({
  week_number: z.number().int().min(1),
  max_tier: z.enum(DIFFICULTY_TIERS),
  max_score: z.number().min(0).max(10),
})

export const profileAnalysisSchema = z.object({
  recommended_split: z.enum(SPLIT_TYPES),
  recommended_periodization: z.enum(PERIODIZATION_TYPES),
  volume_targets: z.array(volumeTargetSchema).min(1),
  exercise_constraints: z.array(exerciseConstraintSchema),
  session_structure: sessionStructureSchema,
  training_age_category: z.enum(["novice", "intermediate", "advanced", "elite"]),
  technique_plan: z.array(techniquePlanWeekSchema).min(1),
  difficulty_ceiling: z.array(difficultyCeilingWeekSchema).min(1),
  notes: z.string().optional().default(""),
})

// ─── Agent 2: Program Skeleton Schema ────────────────────────────────────────

const exerciseSlotSchema = z.object({
  slot_id: z.string(),
  role: z.enum([
    "warm_up", "primary_compound", "secondary_compound",
    "accessory", "isolation", "cool_down",
    "power", "conditioning", "activation", "testing",
  ]),
  movement_pattern: z.enum(MOVEMENT_PATTERNS),
  target_muscles: z.array(z.string()).min(1),
  sets: z.number(),
  reps: z.string(),
  rest_seconds: z.number(),
  rpe_target: z.number().nullable(),
  tempo: z.string().nullable(),
  group_tag: z.string().nullable(),
  technique: z.enum(TECHNIQUES).default("straight_set"),
  intensity_pct: z.number().nullable().optional().default(null),
})

const programDaySchema = z.object({
  day_of_week: z.number(),
  label: z.string(),
  focus: z.string(),
  slots: z.array(exerciseSlotSchema).min(1),
})

const programWeekSchema = z.object({
  week_number: z.number(),
  phase: z.string(),
  intensity_modifier: z.string(),
  days: z.array(programDaySchema).min(1),
})

export const programSkeletonSchema = z.object({
  weeks: z.array(programWeekSchema).min(1),
  split_type: z.enum(SPLIT_TYPES),
  periodization: z.enum(PERIODIZATION_TYPES),
  total_sessions: z.number().optional().default(0),
  notes: z.string().optional().default(""),
})

// ─── Agent 3: Exercise Assignment Schema ─────────────────────────────────────

const assignedExerciseSchema = z.object({
  slot_id: z.string(),
  exercise_id: z.string(),
  exercise_name: z.string(),
  notes: z.string().nullable(),
})

export const exerciseAssignmentSchema = z.object({
  assignments: z.array(assignedExerciseSchema).min(1),
  substitution_notes: z.array(z.string()),
})

// ─── Agent 4: Validation Result Schema ───────────────────────────────────────

const validationIssueSchema = z.object({
  type: z.enum(["error", "warning"]),
  category: z.string(),
  message: z.string(),
  slot_ref: z.string().optional(),
})

export const validationResultSchema = z.object({
  pass: z.boolean(),
  issues: z.array(validationIssueSchema),
  summary: z.string(),
})

// ─── Cross-layer Validators ──────────────────────────────────────────────────

export type TechniquePlanWeek = z.infer<typeof techniquePlanWeekSchema>
export type DifficultyCeilingWeek = z.infer<typeof difficultyCeilingWeekSchema>

export interface ValidatorResult {
  ok: boolean
  violations: string[]
}

/**
 * Validate the program skeleton (Agent 2 output) against the technique_plan
 * produced by Agent 1. Every slot's technique must be in the allowed_techniques
 * list for that week.
 */
export function validateSkeletonAgainstAnalysis(
  skeleton: z.infer<typeof programSkeletonSchema>,
  analysis: z.infer<typeof profileAnalysisSchema>
): ValidatorResult {
  const planByWeek = new Map<number, TechniquePlanWeek>()
  for (const wk of analysis.technique_plan) planByWeek.set(wk.week_number, wk)

  const violations: string[] = []
  for (const week of skeleton.weeks) {
    const plan = planByWeek.get(week.week_number)
    if (!plan) {
      violations.push(`week ${week.week_number}: no technique_plan entry from analysis`)
      continue
    }
    const allowed = new Set<string>(plan.allowed_techniques)
    for (const day of week.days) {
      for (const slot of day.slots) {
        if (!allowed.has(slot.technique)) {
          violations.push(
            `week ${week.week_number} slot ${slot.slot_id}: technique "${slot.technique}" not allowed (allowed: ${plan.allowed_techniques.join(", ")})`
          )
        }
      }
    }
  }
  return { ok: violations.length === 0, violations }
}

/**
 * Validate exercise assignments (Agent 3 output) against the difficulty_ceiling
 * produced by Agent 1. For each week, the assigned exercise must not exceed the
 * ceiling's max_tier; if its tier equals max_tier, its difficulty_score must
 * not exceed max_score.
 *
 * slotInWeek maps slot_id -> week_number (caller builds this from the skeleton).
 * exerciseLibrary must contain difficulty + difficulty_score for each exercise_id.
 */
export function validateAssignmentAgainstCeiling(
  assignment: z.infer<typeof exerciseAssignmentSchema>,
  difficultyCeiling: DifficultyCeilingWeek[],
  slotInWeek: Map<string, number>,
  exerciseLibrary: Array<{ id: string; difficulty: string; difficulty_score: number | null | undefined }>
): ValidatorResult {
  const ceilingByWeek = new Map<number, DifficultyCeilingWeek>()
  for (const c of difficultyCeiling) ceilingByWeek.set(c.week_number, c)

  const exById = new Map(exerciseLibrary.map((e) => [e.id, e]))
  const tierIdx = (tier: string) => DIFFICULTY_TIERS.indexOf(tier as typeof DIFFICULTY_TIERS[number])

  const violations: string[] = []
  for (const a of assignment.assignments) {
    const weekNum = slotInWeek.get(a.slot_id)
    if (weekNum === undefined) continue // skeleton stripped this slot
    const ceiling = ceilingByWeek.get(weekNum)
    if (!ceiling) {
      violations.push(`week ${weekNum} slot ${a.slot_id}: no difficulty_ceiling entry`)
      continue
    }
    const ex = exById.get(a.exercise_id)
    if (!ex) continue // hallucinated id will be stripped elsewhere

    const exIdx = tierIdx(ex.difficulty)
    const maxIdx = tierIdx(ceiling.max_tier)
    if (exIdx === -1 || maxIdx === -1) continue // unknown tier — don't block

    if (exIdx > maxIdx) {
      violations.push(
        `week ${weekNum} slot ${a.slot_id}: exercise "${ex.id}" tier "${ex.difficulty}" exceeds ceiling "${ceiling.max_tier}"`
      )
      continue
    }
    if (exIdx === maxIdx && ex.difficulty_score != null && ex.difficulty_score > ceiling.max_score) {
      violations.push(
        `week ${weekNum} slot ${a.slot_id}: exercise "${ex.id}" score ${ex.difficulty_score} exceeds max_score ${ceiling.max_score}`
      )
    }
  }
  return { ok: violations.length === 0, violations }
}
```

- [ ] **Step 4: Update types.ts to export new types**

Append to `functions/src/ai/types.ts`:

```typescript
// ─── Technique plan & difficulty ceiling (added in 2026-04-14 improvements) ──

export interface TechniquePlanWeek {
  week_number: number
  allowed_techniques: string[]
  default_technique: string
  notes: string
}

export interface DifficultyCeilingWeek {
  week_number: number
  max_tier: "beginner" | "intermediate" | "advanced"
  max_score: number
}
```

Note: If `ProfileAnalysis` type already exists in `types.ts`, add these two fields to it:

```typescript
// In the existing ProfileAnalysis interface, add:
//   technique_plan: TechniquePlanWeek[]
//   difficulty_ceiling: DifficultyCeilingWeek[]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npx vitest run src/ai/__tests__/schemas.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Run type check**

Run: `cd functions && npx tsc --noEmit`
Expected: No type errors. If there are errors in consumers of `ProfileAnalysis`, it's because the new required fields haven't been provided — this is expected until Task 4 updates the Agent 1 prompt. For now, temporarily mark them optional with `.optional()` in the Zod schema OR accept that the orchestrator will need to be updated in Task 6.

If type errors are blocking, add `.optional()` temporarily:
```typescript
// In profileAnalysisSchema:
technique_plan: z.array(techniquePlanWeekSchema).min(1).optional(),
difficulty_ceiling: z.array(difficultyCeilingWeekSchema).min(1).optional(),
```
And remove `.optional()` in Task 6 once orchestrator wiring is complete.

- [ ] **Step 7: Commit**

```bash
git add functions/src/ai/schemas.ts functions/src/ai/types.ts functions/src/ai/__tests__/schemas.test.ts
git commit -m "Add technique_plan + difficulty_ceiling to profile analysis schema

Agent 1 now outputs an explicit technique_plan and difficulty_ceiling
per week. Adds validateSkeletonAgainstAnalysis and
validateAssignmentAgainstCeiling for cross-agent enforcement used by
the orchestrator retry loop."
```

---

## Task 4: Rewrite Agent 1, 2, 3 prompts for new constraints

**Files:**
- Modify: `functions/src/ai/prompts.ts`

- [ ] **Step 1: Update `PROFILE_ANALYZER_PROMPT` output spec**

Open `functions/src/ai/prompts.ts`. Replace the output spec block in `PROFILE_ANALYZER_PROMPT` (the JSON structure starting at line 33) with the expanded spec:

```
Given a client profile (goals, injuries, experience, equipment, preferences, sport) and a training request (duration, sessions per week, etc.), you must output a JSON object with the following structure:

{
  "recommended_split": one of "full_body" | "upper_lower" | "push_pull_legs" | "push_pull" | "body_part" | "movement_pattern" | "custom",
  "recommended_periodization": one of "linear" | "undulating" | "block" | "reverse_linear" | "none",
  "volume_targets": [
    {
      "muscle_group": string,
      "sets_per_week": number,
      "priority": "high" | "medium" | "low"
    }
  ],
  "exercise_constraints": [
    {
      "type": "avoid_movement" | "avoid_equipment" | "avoid_muscle" | "limit_load" | "require_unilateral",
      "value": string,
      "reason": string
    }
  ],
  "session_structure": {
    "warm_up_minutes": number,
    "main_work_minutes": number,
    "cool_down_minutes": number,
    "total_exercises": number,
    "compound_count": number,
    "isolation_count": number
  },
  "training_age_category": "novice" | "intermediate" | "advanced" | "elite",
  "technique_plan": [
    {
      "week_number": number (1..duration_weeks),
      "allowed_techniques": array of one or more of ["straight_set","superset","dropset","giant_set","circuit","rest_pause","amrap","cluster_set","complex","emom","wave_loading"],
      "default_technique": one of the above (MUST be in allowed_techniques for this week),
      "notes": string (one sentence explaining why this week uses these techniques)
    }
  ],
  "difficulty_ceiling": [
    {
      "week_number": number (1..duration_weeks),
      "max_tier": "beginner" | "intermediate" | "advanced",
      "max_score": number (0..10, the maximum difficulty_score allowed at the top tier for this week)
    }
  ],
  "notes": string
}

CRITICAL: technique_plan MUST include one entry for EVERY week (1 through duration_weeks). difficulty_ceiling MUST include one entry for EVERY week. Do not skip weeks. Every slot in every week of the generated program will be validated against these plans, and violations cause regeneration.
```

- [ ] **Step 2: Rewrite rule 12 (time_efficiency_preference) and rule 13 (preferred_techniques) and add new rules 19, 20, 21**

In `PROFILE_ANALYZER_PROMPT`, find rule 12 (starts with "If the athlete provides time_efficiency_preference") and replace rules 12–13 plus append new rules:

```
12. time_efficiency_preference: reflect it in technique_plan only if it aligns with athlete level:
    - "supersets_circuits": for intermediate+ athletes, include "superset" and "circuit" in allowed_techniques for weeks 3+ after a 2-week straight-set foundation. For novices, IGNORE and keep straight sets.
    - "shorter_rest": no impact on technique_plan; applied downstream via rest_seconds in Agent 2.
    - "fewer_heavier": keep technique_plan straight_set-dominant; minimize exercise count.
    - "extend_session": no impact on technique_plan.
13. preferred_techniques handling — respect athlete level above all:
    - NOVICES: technique_plan MUST be `{"allowed_techniques": ["straight_set"], "default_technique": "straight_set"}` for EVERY week. No exceptions. Movement quality and motor learning is the priority.
    - INTERMEDIATE athletes: weeks 1-2 straight_set only; from week 3 you MAY add one additional technique (typically superset on accessories, OR rest_pause on a compound) if preferred_techniques includes it OR if time pressure justifies it. Default_technique stays "straight_set".
    - ADVANCED/ELITE: broader allowed_techniques is appropriate, but still lead with straight_set as default_technique unless the athlete's preferred_techniques explicitly favor something else.
    - Empty preferred_techniques for intermediate+ means "no strong preference" — keep technique variety minimal and intentional, phase-based.

[...existing rules 14-18 unchanged...]

19. technique_plan CONSTRUCTION RULES (mandatory):
    - Weeks 1-2: ALWAYS allowed_techniques = ["straight_set"], default_technique = "straight_set". This is a hard rule for novice and intermediate athletes. Advanced athletes may use a different default IF their preferred_techniques include it AND exercise_constraints permit.
    - Weeks 3+: You MAY expand allowed_techniques ONLY if the program is 4+ weeks AND the athlete is intermediate+. Acceptable expansions: antagonist supersets for accessories, rest_pause for the final compound, or one circuit day.
    - NEVER include circuits, giant_sets, EMOM, or complex for novices.
    - NEVER include more than 2 techniques in allowed_techniques for any single week (keeps sessions coherent).
    - If COACH INSTRUCTIONS says "no supersets" (or lists other disallowed techniques), those techniques MUST be absent from allowed_techniques for EVERY week.
    - If COACH INSTRUCTIONS says "use circuits on Day 3" or prescribes specific methods, include them in allowed_techniques for the relevant weeks.

20. difficulty_ceiling CONSTRUCTION RULES (mandatory):
    - Derive the base tier from training_age_category: novice → "beginner", intermediate → "intermediate", advanced/elite → "advanced".
    - Weeks 1-2: max_tier = base tier, max_score = 4 (conservative start).
    - Weeks 3+: max_tier = base tier, max_score = 6 (still within tier but allow harder exercises within).
    - For 8+ week programs targeting novices: you MAY bump max_score to 7 in the final 2 weeks, but max_tier NEVER rises above "beginner" for novices.
    - For intermediate athletes: in the final third of a 6+ week program, max_tier MAY rise to "advanced" but max_score MUST be <= 4 (low-score advanced only — earned progression).
    - If the client has injuries that constrain load, cap max_score lower (5 instead of 6).

21. technique_plan AND difficulty_ceiling must span EVERY week from 1 through duration_weeks. Missing a week is a schema violation that causes regeneration.
```

- [ ] **Step 3: Update `PROGRAM_ARCHITECT_PROMPT` to honor technique_plan**

In `functions/src/ai/prompts.ts`, find `PROGRAM_ARCHITECT_PROMPT`. Near the top, after the persona paragraphs and before the existing rules, add a new HARD CONSTRAINTS section:

```
HARD CONSTRAINTS FROM AGENT 1 (MUST OBEY):

The Profile Analyzer has produced technique_plan[] and difficulty_ceiling[] arrays as part of the profile analysis. These are not suggestions — they are strict constraints that will be VALIDATED after you generate the skeleton.

1. For each week you generate, every slot's "technique" field MUST be one of the "allowed_techniques" for that week_number from technique_plan.
2. The majority of slots per week SHOULD use the "default_technique" for that week. Use non-default allowed techniques only when there is a clear purpose (antagonist pairing, time pressure, intentional intensity).
3. If technique_plan for a week is `["straight_set"]`, EVERY slot that week MUST be "straight_set". Do not sneak in a superset "to save time." If time is short, reduce total_exercises instead.
4. Do NOT invent techniques. If you need a technique not in allowed_techniques, you are wrong — re-read the plan.

Your output will be re-validated against technique_plan and rejected if any slot uses a disallowed technique. The system will retry with feedback. Obey the plan the first time.
```

Then find the existing rule set (around lines 293-309) about technique selection and REMOVE those rules — they're replaced by the HARD CONSTRAINTS above. Keep the rule that COACH INSTRUCTIONS override other rules (but note the order: COACH INSTRUCTIONS → technique_plan → your judgment).

- [ ] **Step 4: Update `EXERCISE_SELECTOR_PROMPT` to enforce difficulty_ceiling**

In `functions/src/ai/prompts.ts`, find `EXERCISE_SELECTOR_PROMPT`. Add a new HARD CONSTRAINTS section near the top:

```
HARD CONSTRAINTS FROM AGENT 1 (MUST OBEY):

The Profile Analyzer has produced a difficulty_ceiling per week. You will be given the exercise library pre-filtered for this week's ceiling, but you MUST still self-check:

1. For each assignment, confirm the exercise's "difficulty" tier is <= the week's max_tier.
2. If the exercise's tier equals max_tier, confirm its "difficulty_score" <= max_score.
3. NEVER pick an exercise that violates the ceiling, even if it seems "better" for the slot. Pick the best in-ceiling option.
4. If the pre-filtered library has no suitable in-ceiling exercise for a slot (due to a library gap), leave the slot unassigned and add a substitution_note explaining the gap. Do NOT violate the ceiling to fill the slot.

For beginners, this means: week 1 exercises are beginner-tier with difficulty_score <= 4. No intermediate exercises. No "challenge" exercises. Movement quality first.
```

- [ ] **Step 5: Type-check the prompts file**

Run: `cd functions && npx tsc --noEmit`
Expected: No errors (prompts.ts is string constants — no type impact).

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/prompts.ts
git commit -m "Rewrite AI prompts to enforce technique_plan and difficulty_ceiling

Agent 1 now emits technique_plan[] (allowed_techniques per week) and
difficulty_ceiling[] (max_tier + max_score per week). Novices and
intermediates are locked to straight sets for weeks 1-2.

Agent 2 (Program Architect) must honor technique_plan with a HARD
CONSTRAINTS section — schema validation will reject and retry
violations.

Agent 3 (Exercise Selector) must stay within difficulty_ceiling with
matching HARD CONSTRAINTS — leaves slots empty rather than violating
the ceiling when library has gaps."
```

---

## Task 5: Data access layer for exercise usage + coach policy

**Files:**
- Create: `lib/db/exercise-usage.ts` (Next.js side)
- Create: `lib/db/coach-ai-policy.ts` (Next.js side)
- Create: `functions/src/ai/usage-history.ts` (Firebase side — fetches from Supabase via service-role)
- Create: `functions/src/ai/coach-policy.ts` (Firebase side)
- Create: `__tests__/db/exercise-usage.test.ts`
- Create: `__tests__/db/coach-ai-policy.test.ts`

- [ ] **Step 1: Write the failing Next.js DAL tests**

Create `__tests__/db/exercise-usage.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import {
  recordProgramExerciseUsage,
  getCoachRecentUsage,
  getClientRecentUsage,
} from "@/lib/db/exercise-usage"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_COACH = "00000000-0000-0000-0000-0000000aaaaa"
const TEST_CLIENT = "00000000-0000-0000-0000-0000000bbbbb"
const TEST_PROGRAM = "00000000-0000-0000-0000-0000000ccccc"
const TEST_EX_1 = "00000000-0000-0000-0000-0000000ddddd"
const TEST_EX_2 = "00000000-0000-0000-0000-0000000eeeee"

describe("exercise-usage DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("generated_exercise_usage").delete().eq("coach_id", TEST_COACH)
  })

  it("recordProgramExerciseUsage writes rows; getCoachRecentUsage returns them grouped by exercise_id", async () => {
    await recordProgramExerciseUsage({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      program_id: TEST_PROGRAM,
      rows: [
        { exercise_id: TEST_EX_1, week_number: 1, day_number: 1 },
        { exercise_id: TEST_EX_1, week_number: 2, day_number: 1 },
        { exercise_id: TEST_EX_2, week_number: 1, day_number: 2 },
      ],
    })

    const usage = await getCoachRecentUsage(TEST_COACH, 60)
    expect(usage.get(TEST_EX_1)).toBeDefined()
    expect(usage.get(TEST_EX_1)).toBeLessThanOrEqual(1) // days ago, recorded just now
    expect(usage.get(TEST_EX_2)).toBeDefined()
  })

  it("getClientRecentUsage scopes to the given client only", async () => {
    await recordProgramExerciseUsage({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      program_id: TEST_PROGRAM,
      rows: [{ exercise_id: TEST_EX_1, week_number: 1, day_number: 1 }],
    })

    const usage = await getClientRecentUsage(TEST_CLIENT, 90)
    expect(usage.get(TEST_EX_1)).toBeDefined()

    const otherClient = "99999999-9999-9999-9999-999999999999"
    const empty = await getClientRecentUsage(otherClient, 90)
    expect(empty.size).toBe(0)
  })

  it("getCoachRecentUsage respects the daysBack window", async () => {
    // Insert a row 120 days ago
    await supabase.from("generated_exercise_usage").insert({
      coach_id: TEST_COACH,
      client_id: TEST_CLIENT,
      exercise_id: TEST_EX_1,
      program_id: TEST_PROGRAM,
      week_number: 1,
      day_number: 1,
      assigned_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const usage60 = await getCoachRecentUsage(TEST_COACH, 60)
    expect(usage60.size).toBe(0)

    const usage180 = await getCoachRecentUsage(TEST_COACH, 180)
    expect(usage180.get(TEST_EX_1)).toBeDefined()
  })
})
```

Create `__tests__/db/coach-ai-policy.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { getCoachPolicy, upsertCoachPolicy } from "@/lib/db/coach-ai-policy"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_COACH = "00000000-0000-0000-0000-0000000cc001"

describe("coach-ai-policy DAL", () => {
  const supabase = createServiceRoleClient()

  beforeEach(async () => {
    await supabase.from("coach_ai_policy").delete().eq("coach_id", TEST_COACH)
  })

  it("getCoachPolicy returns null when no policy set", async () => {
    const policy = await getCoachPolicy(TEST_COACH)
    expect(policy).toBeNull()
  })

  it("upsertCoachPolicy creates then updates a policy", async () => {
    await upsertCoachPolicy(TEST_COACH, {
      disallowed_techniques: ["circuit", "emom"],
      preferred_techniques: ["straight_set"],
      technique_progression_enabled: true,
      programming_notes: "never use circuits; athletes do sport conditioning outside the gym",
    })
    const p1 = await getCoachPolicy(TEST_COACH)
    expect(p1?.disallowed_techniques).toEqual(["circuit", "emom"])
    expect(p1?.programming_notes).toMatch(/never use circuits/)

    await upsertCoachPolicy(TEST_COACH, {
      disallowed_techniques: ["circuit"],
      preferred_techniques: [],
      technique_progression_enabled: false,
      programming_notes: "",
    })
    const p2 = await getCoachPolicy(TEST_COACH)
    expect(p2?.disallowed_techniques).toEqual(["circuit"])
    expect(p2?.technique_progression_enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/db/exercise-usage.test.ts __tests__/db/coach-ai-policy.test.ts`
Expected: All tests FAIL — DAL files don't exist.

- [ ] **Step 3: Create `lib/db/exercise-usage.ts`**

```typescript
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface UsageRow {
  exercise_id: string
  week_number: number
  day_number: number
}

export interface RecordUsageArgs {
  coach_id: string
  client_id: string | null
  program_id: string
  rows: UsageRow[]
}

/** Insert one row per exercise assignment into generated_exercise_usage. */
export async function recordProgramExerciseUsage(args: RecordUsageArgs): Promise<void> {
  if (args.rows.length === 0) return
  const supabase = getClient()
  const payload = args.rows.map((r) => ({
    coach_id: args.coach_id,
    client_id: args.client_id,
    exercise_id: r.exercise_id,
    program_id: args.program_id,
    week_number: r.week_number,
    day_number: r.day_number,
  }))
  const { error } = await supabase.from("generated_exercise_usage").insert(payload)
  if (error) throw error
}

/**
 * Return a Map<exercise_id, daysSinceLastUse> for exercises this coach has
 * assigned within the last `daysBack` days. Lower number = more recent.
 */
export async function getCoachRecentUsage(
  coachId: string,
  daysBack: number
): Promise<Map<string, number>> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("coach_id", coachId)
    .gte("assigned_at", cutoff)
    .order("assigned_at", { ascending: false })
  if (error) throw error
  return reduceToRecencyMap(data ?? [])
}

/** Same shape as coach usage, scoped to a single client. */
export async function getClientRecentUsage(
  clientId: string,
  daysBack: number
): Promise<Map<string, number>> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("client_id", clientId)
    .gte("assigned_at", cutoff)
    .order("assigned_at", { ascending: false })
  if (error) throw error
  return reduceToRecencyMap(data ?? [])
}

function reduceToRecencyMap(
  rows: Array<{ exercise_id: string; assigned_at: string }>
): Map<string, number> {
  const now = Date.now()
  const out = new Map<string, number>()
  for (const r of rows) {
    const daysAgo = Math.floor((now - new Date(r.assigned_at).getTime()) / (24 * 60 * 60 * 1000))
    if (!out.has(r.exercise_id) || daysAgo < (out.get(r.exercise_id) ?? Infinity)) {
      out.set(r.exercise_id, daysAgo)
    }
  }
  return out
}
```

- [ ] **Step 4: Create `lib/db/coach-ai-policy.ts`**

```typescript
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export interface CoachAiPolicy {
  coach_id: string
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string | null
  updated_at: string
}

export async function getCoachPolicy(coachId: string): Promise<CoachAiPolicy | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("coach_ai_policy")
    .select("*")
    .eq("coach_id", coachId)
    .maybeSingle()
  if (error) throw error
  return data as CoachAiPolicy | null
}

export interface UpsertCoachPolicyInput {
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string
}

export async function upsertCoachPolicy(
  coachId: string,
  input: UpsertCoachPolicyInput
): Promise<CoachAiPolicy> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("coach_ai_policy")
    .upsert({ coach_id: coachId, ...input }, { onConflict: "coach_id" })
    .select()
    .single()
  if (error) throw error
  return data as CoachAiPolicy
}
```

- [ ] **Step 5: Create Firebase-side mirrors**

Create `functions/src/ai/usage-history.ts`:

```typescript
import { getSupabase } from "../lib/supabase.js"

/** Map<exercise_id, daysSinceLastUse> for recent usage within a window. */
export type UsageRecencyMap = Map<string, number>

export async function getCoachRecentUsageFromFn(
  coachId: string,
  daysBack: number
): Promise<UsageRecencyMap> {
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("coach_id", coachId)
    .gte("assigned_at", cutoff)
  if (error) {
    console.warn("[usage-history] getCoachRecentUsage failed:", error.message)
    return new Map()
  }
  return buildRecencyMap(data ?? [])
}

export async function getClientRecentUsageFromFn(
  clientId: string | null,
  daysBack: number
): Promise<UsageRecencyMap> {
  if (!clientId) return new Map()
  const supabase = getSupabase()
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("generated_exercise_usage")
    .select("exercise_id, assigned_at")
    .eq("client_id", clientId)
    .gte("assigned_at", cutoff)
  if (error) {
    console.warn("[usage-history] getClientRecentUsage failed:", error.message)
    return new Map()
  }
  return buildRecencyMap(data ?? [])
}

export async function recordUsageFromFn(args: {
  coach_id: string
  client_id: string | null
  program_id: string
  rows: Array<{ exercise_id: string; week_number: number; day_number: number }>
}): Promise<void> {
  if (args.rows.length === 0) return
  const supabase = getSupabase()
  const payload = args.rows.map((r) => ({
    coach_id: args.coach_id,
    client_id: args.client_id,
    exercise_id: r.exercise_id,
    program_id: args.program_id,
    week_number: r.week_number,
    day_number: r.day_number,
  }))
  const { error } = await supabase.from("generated_exercise_usage").insert(payload)
  if (error) console.warn("[usage-history] recordUsage failed:", error.message)
}

function buildRecencyMap(rows: Array<{ exercise_id: string; assigned_at: string }>): UsageRecencyMap {
  const now = Date.now()
  const out = new Map<string, number>()
  for (const r of rows) {
    const daysAgo = Math.floor((now - new Date(r.assigned_at).getTime()) / (24 * 60 * 60 * 1000))
    if (!out.has(r.exercise_id) || daysAgo < (out.get(r.exercise_id) ?? Infinity)) {
      out.set(r.exercise_id, daysAgo)
    }
  }
  return out
}
```

Create `functions/src/ai/coach-policy.ts`:

```typescript
import { getSupabase } from "../lib/supabase.js"

export interface CoachAiPolicyRow {
  coach_id: string
  disallowed_techniques: string[]
  preferred_techniques: string[]
  technique_progression_enabled: boolean
  programming_notes: string | null
}

export async function getCoachPolicyFromFn(coachId: string): Promise<CoachAiPolicyRow | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("coach_ai_policy")
    .select("*")
    .eq("coach_id", coachId)
    .maybeSingle()
  if (error) {
    console.warn("[coach-policy] getCoachPolicy failed:", error.message)
    return null
  }
  return (data as CoachAiPolicyRow | null) ?? null
}

/**
 * Format a CoachAiPolicyRow as a COACH INSTRUCTIONS section to be appended
 * to the Agent 1 user message. Returns empty string when policy is null.
 */
export function formatCoachPolicyAsInstructions(policy: CoachAiPolicyRow | null): string {
  if (!policy) return ""
  const lines: string[] = ["COACH INSTRUCTIONS (studio-wide AI policy):"]
  if (policy.disallowed_techniques.length > 0) {
    lines.push(`- DO NOT use these techniques: ${policy.disallowed_techniques.join(", ")}. They must be absent from technique_plan for every week.`)
  }
  if (policy.preferred_techniques.length > 0) {
    lines.push(`- Prefer these techniques when multiple are appropriate: ${policy.preferred_techniques.join(", ")}.`)
  }
  if (!policy.technique_progression_enabled) {
    lines.push(`- Keep technique_plan static across weeks — use the same default_technique every week. Do not introduce phase-based technique variation.`)
  }
  if (policy.programming_notes && policy.programming_notes.trim().length > 0) {
    lines.push(`- Additional coach notes: ${policy.programming_notes.trim()}`)
  }
  return lines.length === 1 ? "" : "\n\n" + lines.join("\n")
}
```

- [ ] **Step 6: Run all DAL tests to verify they pass**

Run: `npm run test:run -- __tests__/db/exercise-usage.test.ts __tests__/db/coach-ai-policy.test.ts`
Expected: All tests PASS.

Run: `cd functions && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/exercise-usage.ts lib/db/coach-ai-policy.ts \
  functions/src/ai/usage-history.ts functions/src/ai/coach-policy.ts \
  __tests__/db/exercise-usage.test.ts __tests__/db/coach-ai-policy.test.ts
git commit -m "Add DAL for exercise usage tracking + coach AI policy

Parallel DAL modules for Next.js (lib/db/) and Firebase function
(functions/src/ai/). Firebase side is fail-soft: usage queries swallow
errors and return empty maps so generation is never blocked by
tracking infrastructure."
```

---

## Task 6: History-aware semantic filter

**Files:**
- Modify: `functions/src/ai/exercise-filter.ts`
- Create: `functions/src/ai/__tests__/exercise-filter.test.ts`

- [ ] **Step 1: Write failing test for usage-aware scoring**

Create `functions/src/ai/__tests__/exercise-filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { applyUsagePenalty } from "../exercise-filter.js"

describe("applyUsagePenalty", () => {
  it("returns baseScore unchanged when usage maps are empty", () => {
    const result = applyUsagePenalty(100, "ex-1", new Map(), new Map())
    expect(result).toBe(100)
  })

  it("subtracts 30 when exercise was used by coach within 60 days", () => {
    const coachUsage = new Map([["ex-1", 20]]) // used 20 days ago
    const result = applyUsagePenalty(100, "ex-1", coachUsage, new Map())
    expect(result).toBe(70)
  })

  it("subtracts 50 when exercise was used by this client within 90 days", () => {
    const clientUsage = new Map([["ex-1", 30]])
    const result = applyUsagePenalty(100, "ex-1", new Map(), clientUsage)
    expect(result).toBe(50)
  })

  it("stacks both penalties when exercise was used by both coach and client", () => {
    const result = applyUsagePenalty(
      100,
      "ex-1",
      new Map([["ex-1", 20]]),
      new Map([["ex-1", 30]])
    )
    expect(result).toBe(20) // -30 -50
  })

  it("adds +10 diversity boost when exercise is in neither map", () => {
    const coachUsage = new Map([["other-ex", 10]])
    const clientUsage = new Map([["yet-another", 15]])
    const result = applyUsagePenalty(100, "ex-never-used", coachUsage, clientUsage)
    expect(result).toBe(110)
  })

  it("does NOT apply boost when exercise is in one of the maps", () => {
    const coachUsage = new Map([["ex-1", 20]])
    const result = applyUsagePenalty(100, "ex-1", coachUsage, new Map())
    // Only penalty, no +10 boost
    expect(result).toBe(70)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/ai/__tests__/exercise-filter.test.ts`
Expected: FAIL — `applyUsagePenalty` doesn't exist.

- [ ] **Step 3: Add `applyUsagePenalty` and integrate into filters**

Open `functions/src/ai/exercise-filter.ts`. At the top of the file (after the imports), add:

```typescript
import type { UsageRecencyMap } from "./usage-history.js"

const COACH_USAGE_PENALTY = 30
const CLIENT_USAGE_PENALTY = 50
const DIVERSITY_BOOST = 10

/**
 * Apply usage-history penalties and a diversity boost to a base score.
 * - Used by this coach in last 60 days → -30
 * - Used by this client in last 90 days → -50
 * - Used by neither → +10 (diversity boost)
 */
export function applyUsagePenalty(
  baseScore: number,
  exerciseId: string,
  coachUsage: UsageRecencyMap,
  clientUsage: UsageRecencyMap
): number {
  let score = baseScore
  const inCoach = coachUsage.has(exerciseId)
  const inClient = clientUsage.has(exerciseId)
  if (inCoach) score -= COACH_USAGE_PENALTY
  if (inClient) score -= CLIENT_USAGE_PENALTY
  if (!inCoach && !inClient) score += DIVERSITY_BOOST
  return score
}
```

Now update `scoreAndFilterExercises` and `semanticFilterExercises` to accept optional usage history and apply the penalty. Find the options parameter on `scoreAndFilterExercises` and extend it:

```typescript
// Before:
export function scoreAndFilterExercises(
  exercises: CompressedExercise[], skeleton: ProgramSkeleton,
  equipment: string[], analysis: ProfileAnalysis,
  options?: { poolActive?: boolean }
): CompressedExercise[] {

// After:
export interface FilterOptions {
  poolActive?: boolean
  coachUsage?: UsageRecencyMap
  clientUsage?: UsageRecencyMap
}

export function scoreAndFilterExercises(
  exercises: CompressedExercise[], skeleton: ProgramSkeleton,
  equipment: string[], analysis: ProfileAnalysis,
  options?: FilterOptions
): CompressedExercise[] {
```

Inside the function, after `exerciseMaxScores` is populated (around line 268) and before the `const sorted = ...` sort, apply the penalty:

```typescript
  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  if (coachUsage.size > 0 || clientUsage.size > 0) {
    for (const [id, score] of exerciseMaxScores) {
      exerciseMaxScores.set(id, applyUsagePenalty(score, id, coachUsage, clientUsage))
    }
  }
```

Apply the same change to `semanticFilterExercises`: accept `FilterOptions` and, after matched IDs are collected but before `filtered.slice(0, maxExercises)`, sort `filtered` by usage-aware score. Replace the block:

```typescript
  let filtered = exercises.filter((ex) => matchedIds.has(ex.id))
  if (filtered.length > maxExercises) filtered = filtered.slice(0, maxExercises)
```

with:

```typescript
  let filtered = exercises.filter((ex) => matchedIds.has(ex.id))

  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  if (coachUsage.size > 0 || clientUsage.size > 0) {
    // Re-rank by usage-aware proxy: semantic match gave us the set; now order within
    const scored = filtered.map((ex) => ({
      ex,
      score: applyUsagePenalty(50, ex.id, coachUsage, clientUsage), // 50 is a neutral semantic-match baseline
    }))
    scored.sort((a, b) => b.score - a.score)
    filtered = scored.map((s) => s.ex)
    console.log(`[semanticFilter] Applied usage-aware re-ranking (coach: ${coachUsage.size}, client: ${clientUsage.size})`)
  }

  if (filtered.length > maxExercises) filtered = filtered.slice(0, maxExercises)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/ai/__tests__/exercise-filter.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run type check**

Run: `cd functions && npx tsc --noEmit`
Expected: No type errors. Callers of these filter functions will now need to pass the usage maps, but since they're optional, compilation stays green.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/exercise-filter.ts functions/src/ai/__tests__/exercise-filter.test.ts
git commit -m "Add usage-aware scoring to exercise filters

applyUsagePenalty downranks exercises used by coach (60d) or client
(90d) and rewards never-used exercises with a +10 boost. Integrated
into both scoreAndFilterExercises and semanticFilterExercises behind
optional coachUsage/clientUsage parameters."
```

---

## Task 7: Orchestrator wiring — fetch policy + history, enforce validation, record usage

**Files:**
- Modify: `functions/src/ai/orchestrator.ts`

- [ ] **Step 1: Add imports at top of orchestrator.ts**

Near the other imports (around line 30), add:

```typescript
import { getCoachRecentUsageFromFn, getClientRecentUsageFromFn, recordUsageFromFn } from "./usage-history.js"
import { getCoachPolicyFromFn, formatCoachPolicyAsInstructions } from "./coach-policy.js"
import { filterByProgressionPhase } from "./exercise-context.js"
import { validateSkeletonAgainstAnalysis, validateAssignmentAgainstCeiling } from "./schemas.js"
```

- [ ] **Step 2: Fetch policy + history before Agent 1**

Find the section around line 283–292 where Agent 1 is called in parallel with exercise fetch. Expand the `Promise.all` to also fetch policy and history:

```typescript
    // Agent 1 + exercise fetch + coach policy + usage history in parallel
    await updateJobProgress("analyzing_profile", 1, "Analyzing client profile & fetching exercises")
    await onProgress?.("Analyzing client profile", 1, 5)
    console.log("[orchestrator:sync] Running Agent 1 + supporting fetches in parallel...")
    const [agent1Result, allExercises, coachPolicy, coachUsage, clientUsage] = await Promise.all([
      callAgent<ProfileAnalysis>(augmentedAgent1Prompt, agent1UserMessage, profileAnalysisSchema, { model: MODEL_HAIKU, cacheSystemPrompt: true }),
      getExercisesForAI(),
      getCoachPolicyFromFn(requestedBy),
      getCoachRecentUsageFromFn(requestedBy, 60),
      request.client_id ? getClientRecentUsageFromFn(request.client_id, 90) : Promise.resolve(new Map<string, number>()),
    ])
    tokenUsage.agent1 = agent1Result.tokens_used
    console.log(`[orchestrator:sync] Agent 1 complete. Tokens: ${agent1Result.tokens_used}. Coach policy: ${coachPolicy ? "loaded" : "none"}. Coach usage entries: ${coachUsage.size}. Client usage entries: ${clientUsage.size}.`)
```

- [ ] **Step 3: Inject coach policy into Agent 1 user message (BEFORE Agent 1 call)**

The `agent1UserMessage` is currently built elsewhere. Find where `coachInstructionsSection` is constructed (likely via `buildCoachInstructionsSection` in shared-helpers). Before building `agent1UserMessage`, augment the coach-instructions section with the policy.

Find the line (near where `coachInstructionsSection` is defined, likely around line 250–275) and replace:

```typescript
    const coachInstructionsSection = buildCoachInstructionsSection(request.additional_instructions)
```

with:

```typescript
    const policyInstructions = formatCoachPolicyAsInstructions(coachPolicy)
    const coachInstructionsSection = buildCoachInstructionsSection(
      [request.additional_instructions, policyInstructions].filter(Boolean).join("\n\n")
    )
```

Note: `coachPolicy` is not yet in scope at this point — we fetched it in parallel with Agent 1. If the current structure requires the instructions BEFORE Agent 1 is called, restructure to fetch coach policy FIRST (sequential), then do Agent 1 + usage + exercises in parallel. Acceptable restructure:

```typescript
    // Fetch policy first (needed for Agent 1 message)
    const coachPolicy = await getCoachPolicyFromFn(requestedBy)

    const policyInstructions = formatCoachPolicyAsInstructions(coachPolicy)
    const coachInstructionsSection = buildCoachInstructionsSection(
      [request.additional_instructions, policyInstructions].filter(Boolean).join("\n\n")
    )

    // ... existing agent1UserMessage construction ...

    // Agent 1 + supporting fetches in parallel
    const [agent1Result, allExercises, coachUsage, clientUsage] = await Promise.all([
      callAgent<ProfileAnalysis>(augmentedAgent1Prompt, agent1UserMessage, profileAnalysisSchema, { model: MODEL_HAIKU, cacheSystemPrompt: true }),
      getExercisesForAI(),
      getCoachRecentUsageFromFn(requestedBy, 60),
      request.client_id ? getClientRecentUsageFromFn(request.client_id, 90) : Promise.resolve(new Map<string, number>()),
    ])
```

- [ ] **Step 4: Replace `filterByDifficultyLevel` call with `filterByProgressionPhase` per week**

Find the block around line 312–317:

```typescript
    const clientDifficultyLevel = profile?.experience_level ?? (request.ignore_profile ? "elite" : "beginner")
    let compressed = filterByDifficultyLevel(poolFiltered, clientDifficultyLevel)
    if (assessmentContext) compressed = filterByDifficultyScore(compressed, assessmentContext.maxDifficultyScore)
```

Keep this as the BASE filter (it still provides the hard exclusion at the top-level library — the progression-phase filter runs per week inside the Agent 3 loop). The base filter now uses the stricter new `filterByDifficultyLevel`.

THEN, in the Agent 3 week-by-week loop (around line 398, inside `for (const week of skeleton.weeks)`), add a per-week progression filter:

Find where `exerciseLibrary` is passed to the agent3 user message (around line 448) and just before that, scope the library for this week:

```typescript
      // Per-week progression filter: may tighten library for early weeks
      const thisWeekLibrary = filterByProgressionPhase(filtered, clientDifficultySync, weekNum)
      const thisWeekLibraryText = formatExerciseLibrary(thisWeekLibrary)
```

Then replace `${exerciseLibrary}` in the agent3UserMessage template with `${thisWeekLibraryText}` and `filtered.length` with `thisWeekLibrary.length` in the message text.

- [ ] **Step 5: Pass usage history to the semantic filter**

Find the semantic filter call (around line 375–377):

```typescript
    try { filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis, { poolActive }) }
    catch { filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis, { poolActive }) }
```

Replace with:

```typescript
    try { filtered = await semanticFilterExercises(compressed, skeleton, availableEquipment, analysis, { poolActive, coachUsage, clientUsage }) }
    catch { filtered = scoreAndFilterExercises(compressed, skeleton, availableEquipment, analysis, { poolActive, coachUsage, clientUsage }) }
```

- [ ] **Step 6: Add skeleton + assignment validation to the retry loop**

Inside the week-by-week loop, find where `weekValidation` is constructed after `validateProgram` (around line 472). Keep the existing call. Right after it, add technique and ceiling validation:

```typescript
          // NEW: technique_plan validation (skeleton-level, run once per week)
          const skelCheck = validateSkeletonAgainstAnalysis(weekSkeletonPayload as ProgramSkeleton, analysis)
          if (!skelCheck.ok) {
            for (const v of skelCheck.violations) {
              weekValidation.issues.push({ type: "error", category: "technique_plan_violation", message: v })
            }
            weekValidation.pass = false
          }

          // NEW: difficulty_ceiling validation
          const slotInWeek = new Map<string, number>()
          for (const day of weekSkeleton.days) for (const slot of day.slots) slotInWeek.set(slot.slot_id, weekNum)
          const ceilingCheck = validateAssignmentAgainstCeiling(
            weekAssignment,
            analysis.difficulty_ceiling,
            slotInWeek,
            compressed.map((e) => ({ id: e.id, difficulty: e.difficulty, difficulty_score: e.difficulty_score }))
          )
          if (!ceilingCheck.ok) {
            for (const v of ceilingCheck.violations) {
              weekValidation.issues.push({ type: "error", category: "difficulty_ceiling_violation", message: v })
            }
            weekValidation.pass = false
          }
```

- [ ] **Step 7: Record exercise usage after successful generation**

Find the section near the end of the orchestrator where the program is created (around line 554–580 — `deriveProgramCategory`, `bulkAddExercisesToProgram`, etc.). After the program has been successfully created and saved (after `bulkAddExercisesToProgram` completes), insert:

```typescript
    // Record exercise usage for future variety enforcement
    if (programId) {
      const usageRows = completedWeeksSync.flatMap((w) =>
        w.assignments.map((a) => {
          // Derive day_number from the slot's day in the skeleton
          const slotInfo = slotLookups.slotToDay?.get(a.slot_id)
          return {
            exercise_id: a.exercise_id,
            week_number: w.week_number,
            day_number: slotInfo?.day_of_week ?? 1,
          }
        })
      )
      recordUsageFromFn({
        coach_id: requestedBy,
        client_id: request.client_id ?? null,
        program_id: programId,
        rows: usageRows,
      }).catch((e) => console.warn("[orchestrator:sync] recordUsage failed (non-blocking):", e instanceof Error ? e.message : e))
    }
```

Note: `slotLookups` is produced by `buildSlotLookups(skeleton)` already used in the orchestrator — find where that's called and ensure `slotToDay` is exposed. If not, construct the mapping inline:

```typescript
      const slotToDayMap = new Map<string, number>()
      for (const week of skeleton.weeks) for (const day of week.days) for (const slot of day.slots) slotToDayMap.set(slot.slot_id, day.day_of_week)

      const usageRows = completedWeeksSync.flatMap((w) =>
        w.assignments.map((a) => ({
          exercise_id: a.exercise_id,
          week_number: w.week_number,
          day_number: slotToDayMap.get(a.slot_id) ?? 1,
        }))
      )
```

- [ ] **Step 8: Type check and run existing tests**

Run: `cd functions && npx tsc --noEmit`
Expected: Clean (resolve any errors about `ProfileAnalysis` missing `technique_plan`/`difficulty_ceiling` — if Task 3's temporary `.optional()` was left in, the code paths using those fields need guards OR remove `.optional()` now).

If you temporarily made `technique_plan` optional in Task 3, now is the time to remove `.optional()` — all orchestrator paths depend on these fields.

Run: `cd functions && npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 9: Commit**

```bash
git add functions/src/ai/orchestrator.ts functions/src/ai/schemas.ts
git commit -m "Wire orchestrator to new policy, history, and schema validators

- Fetches coach_ai_policy and injects into Agent 1 instructions.
- Fetches coach (60d) and client (90d) usage history, feeds into
  semantic filter for usage-aware scoring.
- Runs filterByProgressionPhase per week to lock early weeks to
  stricter difficulty tiers.
- Extends retry loop with validateSkeletonAgainstAnalysis and
  validateAssignmentAgainstCeiling — Agent 2 and Agent 3 regenerate
  when they violate technique_plan or difficulty_ceiling.
- Records assignments to generated_exercise_usage after successful
  program creation (fire-and-forget, never blocks generation)."
```

---

## Task 8: Admin UI for coach AI policy

**Files:**
- Create: `app/(admin)/admin/settings/ai-policy/page.tsx`
- Create: `app/api/admin/ai-policy/route.ts`
- Create: `components/admin/ai-policy-form.tsx`
- Modify: `components/admin/admin-sidebar.tsx` (add nav link — find the file and add link)

- [ ] **Step 1: Create API route for policy GET/PUT**

Create `app/api/admin/ai-policy/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getCoachPolicy, upsertCoachPolicy } from "@/lib/db/coach-ai-policy"
import { z } from "zod"

const TECHNIQUES = [
  "straight_set","superset","dropset","giant_set","circuit",
  "rest_pause","amrap","cluster_set","complex","emom","wave_loading",
] as const

const policyInputSchema = z.object({
  disallowed_techniques: z.array(z.enum(TECHNIQUES)),
  preferred_techniques: z.array(z.enum(TECHNIQUES)),
  technique_progression_enabled: z.boolean(),
  programming_notes: z.string().max(4000),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const policy = await getCoachPolicy(session.user.id)
  return NextResponse.json({ policy })
}

export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  const parsed = policyInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }
  const updated = await upsertCoachPolicy(session.user.id, parsed.data)
  return NextResponse.json({ policy: updated })
}
```

- [ ] **Step 2: Create the admin page**

Create `app/(admin)/admin/settings/ai-policy/page.tsx`:

```typescript
import { Metadata } from "next"
import { auth } from "@/lib/auth"
import { getCoachPolicy } from "@/lib/db/coach-ai-policy"
import { AiPolicyForm } from "@/components/admin/ai-policy-form"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "AI Program Policy — DJP Athlete Admin" }

export default async function AiPolicyPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const policy = await getCoachPolicy(session.user.id)

  return (
    <div className="container py-8 max-w-3xl">
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-heading text-primary">AI Program Policy</h1>
        <p className="text-sm text-muted-foreground">
          Control how the AI generates programs across all of your clients. These
          rules are injected into every program generation as coach instructions
          and override the AI's defaults.
        </p>
      </div>
      <AiPolicyForm initialPolicy={policy} />
    </div>
  )
}
```

- [ ] **Step 3: Create the form component**

Create `components/admin/ai-policy-form.tsx`:

```typescript
"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import type { CoachAiPolicy } from "@/lib/db/coach-ai-policy"

const TECHNIQUES = [
  { id: "straight_set", label: "Straight sets" },
  { id: "superset", label: "Supersets" },
  { id: "dropset", label: "Drop sets" },
  { id: "giant_set", label: "Giant sets" },
  { id: "circuit", label: "Circuits" },
  { id: "rest_pause", label: "Rest-pause" },
  { id: "amrap", label: "AMRAP" },
  { id: "cluster_set", label: "Cluster sets" },
  { id: "complex", label: "Complexes" },
  { id: "emom", label: "EMOM" },
  { id: "wave_loading", label: "Wave loading" },
] as const

export function AiPolicyForm({ initialPolicy }: { initialPolicy: CoachAiPolicy | null }) {
  const [disallowed, setDisallowed] = useState<string[]>(initialPolicy?.disallowed_techniques ?? [])
  const [preferred, setPreferred] = useState<string[]>(initialPolicy?.preferred_techniques ?? [])
  const [progression, setProgression] = useState(initialPolicy?.technique_progression_enabled ?? true)
  const [notes, setNotes] = useState(initialPolicy?.programming_notes ?? "")
  const [isPending, startTransition] = useTransition()

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await fetch("/api/admin/ai-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disallowed_techniques: disallowed,
          preferred_techniques: preferred,
          technique_progression_enabled: progression,
          programming_notes: notes.trim(),
        }),
      })
      if (!res.ok) { toast.error("Failed to save policy"); return }
      toast.success("AI policy updated — applies to your next generation")
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-3">
        <Label className="text-base">Disallowed techniques</Label>
        <p className="text-sm text-muted-foreground">
          The AI will NEVER use these in any program. Useful if you don't program circuits, EMOMs, etc.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TECHNIQUES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={disallowed.includes(t.id)}
                onCheckedChange={() => toggle(setDisallowed, t.id)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <Label className="text-base">Preferred techniques</Label>
        <p className="text-sm text-muted-foreground">
          When the AI has a choice, favor these. Leave blank to let the AI decide by goal and phase.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TECHNIQUES.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={preferred.includes(t.id)}
                onCheckedChange={() => toggle(setPreferred, t.id)}
                disabled={disallowed.includes(t.id)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base">Phase-based technique progression</Label>
            <p className="text-sm text-muted-foreground">
              When ON, the AI introduces variety across weeks (e.g., straight sets early, supersets later).
              When OFF, it keeps the same technique every week.
            </p>
          </div>
          <Switch checked={progression} onCheckedChange={setProgression} />
        </div>
      </section>

      <section className="space-y-3">
        <Label htmlFor="notes" className="text-base">Programming notes (free-form)</Label>
        <p className="text-sm text-muted-foreground">
          Anything the AI should always know about how you program. Injected as coach instructions.
        </p>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="e.g., My athletes do sport conditioning outside the gym — keep gym work strength-focused. Prefer dumbbells over barbells for beginners."
          maxLength={4000}
        />
      </section>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save policy"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Add sidebar link**

Find `components/admin/admin-sidebar.tsx` (or wherever the admin nav is defined — grep for existing admin settings links). Add a link to `/admin/settings/ai-policy` with label "AI Policy" under Settings.

Example addition (adapt to actual sidebar structure):

```typescript
{ href: "/admin/settings/ai-policy", label: "AI Policy", icon: Brain },
```

Run: `npm run dev` (ignore the startup; just confirm no immediate TS errors).

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`
Navigate: `http://localhost:3050/admin/settings/ai-policy` (logged in as admin)
Verify:
- Page loads
- Checking "circuit" in disallowed disables it in preferred
- Saving shows success toast
- Refresh shows saved values

- [ ] **Step 6: Run type check and lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add app/\(admin\)/admin/settings/ai-policy/ app/api/admin/ai-policy/ components/admin/ai-policy-form.tsx components/admin/admin-sidebar.tsx
git commit -m "Add admin UI for coach AI program policy

Coach can configure studio-wide disallowed techniques, preferred
techniques, a phase-progression toggle, and free-form programming
notes. All are injected into every AI generation as coach
instructions."
```

---

## Task 9: End-to-end integration tests

**Files:**
- Create: `functions/src/ai/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `functions/src/ai/__tests__/integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { filterByProgressionPhase } from "../exercise-context.js"
import { applyUsagePenalty } from "../exercise-filter.js"
import { validateSkeletonAgainstAnalysis, profileAnalysisSchema } from "../schemas.js"
import type { CompressedExercise, ProgramSkeleton, ProfileAnalysis } from "../types.js"

// Synthetic exercise library with known properties
const mkEx = (id: string, difficulty: string, score: number, pattern: string, muscles: string[]): CompressedExercise => ({
  id, name: id, difficulty, difficulty_score: score,
  movement_pattern: pattern, primary_muscles: muscles, secondary_muscles: [],
  equipment_required: [], is_bodyweight: false,
  training_intent: ["build"], sport_tags: [], joints_loaded: [],
  plane_of_motion: ["sagittal"],
} as unknown as CompressedExercise)

describe("Integration: full filter pipeline for two beginners", () => {
  const library: CompressedExercise[] = [
    // Lots of beginner squat variations
    mkEx("squat-bw", "beginner", 1, "squat", ["quads"]),
    mkEx("squat-goblet", "beginner", 3, "squat", ["quads"]),
    mkEx("squat-box", "beginner", 2, "squat", ["quads"]),
    mkEx("squat-wall", "beginner", 1, "squat", ["quads"]),
    mkEx("squat-barbell", "intermediate", 5, "squat", ["quads"]),
    mkEx("squat-front", "advanced", 8, "squat", ["quads"]),
    // Lots of beginner push
    mkEx("push-dbbp", "beginner", 3, "push", ["chest"]),
    mkEx("push-db-shoulder", "beginner", 2, "push", ["shoulders"]),
    mkEx("push-bw-pushup", "beginner", 1, "push", ["chest"]),
  ]

  it("different beginner clients under the same coach get materially different exercises", () => {
    const client1Usage = new Map<string, number>() // fresh client 1
    const client2Usage = new Map<string, number>() // fresh client 2
    const coachUsageAfterClient1 = new Map<string, number>([
      ["squat-bw", 1], ["squat-goblet", 1], ["push-dbbp", 1],
    ])

    // Simulate scoring for client 1 (fresh coach history)
    const scores1 = library.map((ex) => ({
      id: ex.id,
      score: applyUsagePenalty(50, ex.id, new Map(), client1Usage),
    }))
    const top1 = [...scores1].sort((a, b) => b.score - a.score).slice(0, 4).map((s) => s.id)

    // Client 2: coach has now used client 1's top picks — they should be down-ranked
    const scores2 = library.map((ex) => ({
      id: ex.id,
      score: applyUsagePenalty(50, ex.id, coachUsageAfterClient1, client2Usage),
    }))
    const top2 = [...scores2].sort((a, b) => b.score - a.score).slice(0, 4).map((s) => s.id)

    const overlap = top1.filter((id) => top2.includes(id))
    expect(overlap.length).toBeLessThan(top1.length / 2) // less than 50% overlap
  })
})

describe("Integration: progression across weeks for a beginner", () => {
  const library: CompressedExercise[] = [
    mkEx("b1", "beginner", 2, "squat", ["quads"]),
    mkEx("b2", "beginner", 3, "squat", ["quads"]),
    mkEx("i-easy", "intermediate", 4, "squat", ["quads"]),  // eligible week 3+
    mkEx("i-hard", "intermediate", 7, "squat", ["quads"]),  // never eligible for beginner
    mkEx("a", "advanced", 8, "squat", ["quads"]),           // never eligible for beginner
  ]

  it("week 1: no intermediate or advanced for a beginner", () => {
    const r = filterByProgressionPhase(library, "beginner", 1)
    expect(r.map((e) => e.id).sort()).toEqual(["b1", "b2"])
  })

  it("week 3: low-score intermediate becomes eligible", () => {
    const r = filterByProgressionPhase(library, "beginner", 3)
    expect(r.map((e) => e.id).sort()).toEqual(["b1", "b2", "i-easy"])
  })

  it("never allows advanced for a beginner, any week", () => {
    for (let w = 1; w <= 12; w++) {
      const r = filterByProgressionPhase(library, "beginner", w)
      expect(r.map((e) => e.id)).not.toContain("a")
    }
  })
})

describe("Integration: technique_plan enforcement in skeleton validation", () => {
  const analysis = profileAnalysisSchema.parse({
    recommended_split: "full_body",
    recommended_periodization: "linear",
    volume_targets: [{ muscle_group: "quads", sets_per_week: 10, priority: "high" }],
    exercise_constraints: [],
    session_structure: { warm_up_minutes: 5, main_work_minutes: 45, cool_down_minutes: 5, total_exercises: 5, compound_count: 2, isolation_count: 3 },
    training_age_category: "novice",
    technique_plan: [
      { week_number: 1, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 2, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 3, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
      { week_number: 4, allowed_techniques: ["straight_set"], default_technique: "straight_set", notes: "" },
    ],
    difficulty_ceiling: [
      { week_number: 1, max_tier: "beginner", max_score: 4 },
      { week_number: 2, max_tier: "beginner", max_score: 4 },
      { week_number: 3, max_tier: "beginner", max_score: 6 },
      { week_number: 4, max_tier: "beginner", max_score: 6 },
    ],
    notes: "",
  }) as ProfileAnalysis

  const baseSlot = {
    slot_id: "s1", role: "primary_compound" as const, movement_pattern: "squat" as const,
    target_muscles: ["quads"], sets: 3, reps: "8-10", rest_seconds: 120,
    rpe_target: null, tempo: null, group_tag: null, intensity_pct: null,
  }

  it("rejects a novice beginner skeleton that uses supersets anywhere", () => {
    const skeleton: ProgramSkeleton = {
      weeks: [1, 2, 3, 4].map((wk) => ({
        week_number: wk, phase: "A", intensity_modifier: "moderate",
        days: [{
          day_of_week: 1, label: "Mon", focus: "legs",
          slots: [{ ...baseSlot, slot_id: `s-${wk}`, technique: wk === 3 ? "superset" as const : "straight_set" as const }],
        }],
      })),
      split_type: "full_body", periodization: "linear", total_sessions: 4, notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(false)
    expect(result.violations.join(" ")).toMatch(/week 3.*superset/i)
  })

  it("passes when every week uses only straight_set", () => {
    const skeleton: ProgramSkeleton = {
      weeks: [1, 2, 3, 4].map((wk) => ({
        week_number: wk, phase: "A", intensity_modifier: "moderate",
        days: [{
          day_of_week: 1, label: "Mon", focus: "legs",
          slots: [{ ...baseSlot, slot_id: `s-${wk}`, technique: "straight_set" as const }],
        }],
      })),
      split_type: "full_body", periodization: "linear", total_sessions: 4, notes: "",
    }
    const result = validateSkeletonAgainstAnalysis(skeleton, analysis)
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `cd functions && npx vitest run src/ai/__tests__/integration.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run the full test suite**

Run: `cd functions && npx vitest run`
Expected: All Firebase function tests pass.

Run: `npm run test:run`
Expected: All Next.js tests pass.

- [ ] **Step 4: Manual end-to-end smoke test**

1. `npm run dev`
2. Go to `/admin/settings/ai-policy`
3. Set disallowed_techniques to `["circuit", "emom"]` and save
4. Go to client management, pick a test client with `experience_level: "beginner"`
5. Generate a new program (4 weeks, 3 sessions/week)
6. Inspect the resulting program:
   - **Verify:** No exercises marked `advanced`, no exercises with `difficulty_score > 4` in weeks 1–2
   - **Verify:** All slots in weeks 1–2 have `technique: "straight_set"`
   - **Verify:** No slot has `technique: "circuit"` or `"emom"` in any week
7. Generate a second program for a DIFFERENT beginner client under the same coach
   - **Verify:** At least 50% of exercises differ from the first program

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/__tests__/integration.test.ts
git commit -m "Add integration tests for difficulty progression, usage diversity, and technique_plan enforcement"
```

---

## Self-Review Checklist (run after completing all tasks)

- [ ] Beginners generated after these changes never receive `advanced` exercises (spot-check 3 programs)
- [ ] Beginners in weeks 1–2 never receive `intermediate` exercises
- [ ] Two distinct beginner clients under the same coach receive noticeably different programs
- [ ] When coach AI policy disallows a technique, it does not appear in any generated program
- [ ] `generated_exercise_usage` rows are created after every successful program generation (query the table and verify)
- [ ] Orchestrator retry loop correctly regenerates when Agent 2 violates technique_plan (check logs for `technique_plan_violation`)
- [ ] Orchestrator retry loop correctly regenerates when Agent 3 violates difficulty_ceiling (check logs for `difficulty_ceiling_violation`)

---

## Out of Scope

- Retraining Anthropic models.
- Backfilling `generated_exercise_usage` from historical programs (starts empty; builds up from the next generation onward).
- Per-client UI to see which exercises were assigned when (potential future admin feature).
- Multi-coach aggregation for franchise scenarios.
