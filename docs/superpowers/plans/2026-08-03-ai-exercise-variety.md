# AI Exercise Variety & Instruction-Aware Retrieval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coach instructions actually change which exercises the AI can pick, and make two identical generations produce meaningfully different programs.

**Architecture:** A Haiku pre-pass turns free-text coach instructions into a structured `InstructionIntent`, which a pure resolver converts into `unlockedIds` / `bannedIds` against the exercise library. Unlocked exercises bypass the two *guessed* input filters (equipment availability, difficulty tier) and the two validators that would otherwise veto them; assessment-derived and injury filters stay absolute. Separately, the candidate ranker starts using the embedding similarity it already fetches, gains per-run seeded tie-break jitter, and applies MMR *before* truncation instead of after (where it was a no-op).

**Tech Stack:** TypeScript (ESM, `functions/` has `rootDir: "src"`), Vitest, Zod v4, Anthropic SDK, Supabase JS.

## Global Constraints

- `functions/` cannot import from `lib/` (`rootDir: "src"`). Everything here lives under `functions/src/`. No twin copy is needed — the generation pipeline is functions-only (`lib/ai/` has no orchestrator or exercise-filter).
- All new imports use the `.js` extension (ESM).
- Tests run with `cd functions; npm test` (`vitest run`). Targeted: `npx vitest run src/ai/__tests__/<file>`.
- Build gate: `cd functions; npx tsc --noEmit`.
- New filter parameters must be **optional trailing parameters** so every existing caller and test compiles unchanged.
- Assessment-derived limits (`filterByDifficultyScore`, `validateProgram`'s `difficulty_score_violation`) and the injury filter (`filterByInjuredJoints`) are NEVER bypassed.
- No new feature flag. This is a correctness fix on an existing path, not new money/mass-email risk.
- Never set `temperature`.

---

### Task 1: Intent types, name matching, and pure resolution

**Files:**
- Create: `functions/src/ai/instruction-intent.ts`
- Modify: `functions/src/ai/validate.ts` (export `CANONICAL_EQUIPMENT`)
- Test: `functions/src/ai/__tests__/instruction-intent.test.ts`

**Interfaces:**
- Consumes: `CompressedExercise` from `./types.js`, `normalizeEquipment` from `./validate.js`
- Produces:
  - `InstructionIntent = { required_equipment: string[]; excluded_equipment: string[]; named_exercises: string[]; excluded_exercises: string[] }`
  - `EMPTY_INTENT: InstructionIntent`
  - `instructionIntentSchema: ZodType<InstructionIntent>`
  - `IntentResolution = { unlockedIds: Set<string>; bannedIds: Set<string>; matched: Array<{ phrase: string; exercise_ids: string[] }>; unmatched: string[] }`
  - `resolveIntentToExerciseIds(intent, exercises): IntentResolution`
  - `normalizeExerciseName(name: string): string`
  - `significantTokens(phrase: string): string[]`
  - `fallbackIntent(instructions: string): InstructionIntent`

- [ ] **Step 1: Export the equipment vocabulary**

In `functions/src/ai/validate.ts`, change `const CANONICAL_EQUIPMENT = [` to `export const CANONICAL_EQUIPMENT = [`.

- [ ] **Step 2: Write the failing tests**

Create `functions/src/ai/__tests__/instruction-intent.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  EMPTY_INTENT,
  fallbackIntent,
  normalizeExerciseName,
  resolveIntentToExerciseIds,
  significantTokens,
} from "../instruction-intent.js"
import type { CompressedExercise } from "../types.js"

function ex(id: string, name: string, equipment: string[] = [], overrides: Partial<CompressedExercise> = {}): CompressedExercise {
  return {
    id, name, category: ["strength"], difficulty: "intermediate", difficulty_score: 5,
    muscle_group: "chest", movement_pattern: "push", primary_muscles: ["chest"],
    secondary_muscles: [], force_type: "push", laterality: "bilateral",
    equipment_required: equipment, is_bodyweight: equipment.length === 0,
    training_intent: ["build"], sport_tags: [], plane_of_motion: ["sagittal"],
    joints_loaded: [], ...overrides,
  } as CompressedExercise
}

// Mirrors real library rows, including the "_Muscle" suffix naming convention.
const LIB = [
  ex("bs", "Back Squat", ["barbell"]),
  ex("bp", "Bench Press", ["barbell", "bench"]),
  ex("dbp", "Dumbbell Barrel bench press_chest", ["dumbbell", "bench"]),
  ex("dl", "Deadlift single reps_Quadricep", ["barbell"]),
  ex("pu", "Push up_Chest", []),
  ex("slrdl", "Sweeping SL RDL_Hamstring", []),
]

describe("normalizeExerciseName", () => {
  it("flattens the _Muscle suffix and punctuation into tokens", () => {
    expect(normalizeExerciseName("Push up_Chest")).toBe("push up chest")
    expect(normalizeExerciseName("Hip and Shoulder disassociation-Core")).toBe("hip and shoulder disassociation core")
  })
})

describe("significantTokens", () => {
  it("drops stopwords and sub-3-character tokens", () => {
    expect(significantTokens("the bench press")).toEqual(["bench", "press"])
  })
})

describe("resolveIntentToExerciseIds", () => {
  it("unlocks every variant matching a named lift", () => {
    const r = resolveIntentToExerciseIds({ ...EMPTY_INTENT, named_exercises: ["bench press"] }, LIB)
    expect(r.unlockedIds.has("bp")).toBe(true)
    expect(r.unlockedIds.has("dbp")).toBe(true)
    expect(r.unlockedIds.has("bs")).toBe(false)
  })

  it("unlocks the five lifts from the real production instruction", () => {
    const r = resolveIntentToExerciseIds(
      { ...EMPTY_INTENT, named_exercises: ["squat", "bench press", "deadlift", "overhead press", "barbell row"] },
      LIB,
    )
    expect(r.unlockedIds.has("bs")).toBe(true)
    expect(r.unlockedIds.has("bp")).toBe(true)
    expect(r.unlockedIds.has("dl")).toBe(true)
  })

  it("reports named phrases with no library match", () => {
    const r = resolveIntentToExerciseIds({ ...EMPTY_INTENT, named_exercises: ["barbell row"] }, LIB)
    expect(r.unmatched).toContain("barbell row")
    expect(r.unlockedIds.size).toBe(0)
  })

  it("bans exercises requiring excluded equipment", () => {
    const r = resolveIntentToExerciseIds({ ...EMPTY_INTENT, excluded_equipment: ["barbell"] }, LIB)
    expect(r.bannedIds.has("bs")).toBe(true)
    expect(r.bannedIds.has("pu")).toBe(false)
  })

  it("lets a ban beat an unlock for the same exercise", () => {
    const r = resolveIntentToExerciseIds(
      { ...EMPTY_INTENT, named_exercises: ["back squat"], excluded_exercises: ["back squat"] },
      LIB,
    )
    expect(r.bannedIds.has("bs")).toBe(true)
    expect(r.unlockedIds.has("bs")).toBe(false)
  })
})

describe("fallbackIntent", () => {
  it("extracts equipment from affirmative text", () => {
    expect(fallbackIntent("use barbell and kettlebell work").required_equipment).toEqual(
      expect.arrayContaining(["barbell", "kettlebell"]),
    )
  })

  it("returns EMPTY_INTENT when negation is present, rather than unlocking backwards", () => {
    expect(fallbackIntent("NO barbell back squats")).toEqual(EMPTY_INTENT)
    expect(fallbackIntent("Minimize bilateral pressing")).toEqual(EMPTY_INTENT)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd functions; npx vitest run src/ai/__tests__/instruction-intent.test.ts`
Expected: FAIL — cannot resolve `../instruction-intent.js`.

- [ ] **Step 4: Implement the module (pure parts only)**

Create `functions/src/ai/instruction-intent.ts`:

```ts
import { z } from "zod"
import type { CompressedExercise } from "./types.js"
import { CANONICAL_EQUIPMENT, normalizeEquipment } from "./validate.js"

export const instructionIntentSchema = z.object({
  required_equipment: z.array(z.string()),
  excluded_equipment: z.array(z.string()),
  named_exercises: z.array(z.string()),
  excluded_exercises: z.array(z.string()),
})

export type InstructionIntent = z.infer<typeof instructionIntentSchema>

export const EMPTY_INTENT: InstructionIntent = {
  required_equipment: [],
  excluded_equipment: [],
  named_exercises: [],
  excluded_exercises: [],
}

export interface IntentResolution {
  unlockedIds: Set<string>
  bannedIds: Set<string>
  matched: Array<{ phrase: string; exercise_ids: string[] }>
  unmatched: string[]
}

const NAME_STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "use", "using", "from", "into", "onto", "per",
])

/**
 * Flatten a library name to comparable tokens. The library uses a "_Muscle"
 * suffix convention ("Push up_Chest") and occasional dashes
 * ("...disassociation-Core"); collapsing every non-alphanumeric run to a space
 * handles both without needing to guess where the suffix starts.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function significantTokens(phrase: string): string[] {
  return normalizeExerciseName(phrase)
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t))
}

/**
 * Resolve a coach's named/excluded phrases to concrete exercise ids.
 *
 * A phrase matches an exercise when EVERY significant token of the phrase
 * appears in the exercise's normalized name. "bench press" therefore unlocks
 * "Bench Press", "Dumbbell Barrel bench press_chest" and "Iso bench press_chest"
 * — which is the intent: the coach asked for bench pressing, not one row.
 *
 * required_equipment is deliberately NOT resolved to ids here. It widens the
 * caller's available-equipment set instead, which composes with the existing
 * equipment filter and validator rather than duplicating their logic.
 */
export function resolveIntentToExerciseIds(
  intent: InstructionIntent,
  exercises: CompressedExercise[],
): IntentResolution {
  const tokensById = new Map<string, Set<string>>()
  for (const ex of exercises) {
    tokensById.set(ex.id, new Set(normalizeExerciseName(ex.name).split(" ")))
  }

  const unlockedIds = new Set<string>()
  const bannedIds = new Set<string>()
  const matched: Array<{ phrase: string; exercise_ids: string[] }> = []
  const unmatched: string[] = []

  const collect = (phrases: string[], sink: Set<string>, track: boolean) => {
    for (const phrase of phrases) {
      const tokens = significantTokens(phrase)
      if (tokens.length === 0) {
        if (track) unmatched.push(phrase)
        continue
      }
      const ids: string[] = []
      for (const ex of exercises) {
        const nameSet = tokensById.get(ex.id)
        if (!nameSet) continue
        if (tokens.every((t) => nameSet.has(t))) {
          ids.push(ex.id)
          sink.add(ex.id)
        }
      }
      if (!track) continue
      if (ids.length > 0) matched.push({ phrase, exercise_ids: ids })
      else unmatched.push(phrase)
    }
  }

  collect(intent.named_exercises, unlockedIds, true)
  collect(intent.excluded_exercises, bannedIds, false)

  const excludedEquipment = new Set(intent.excluded_equipment.map(normalizeEquipment))
  if (excludedEquipment.size > 0) {
    for (const ex of exercises) {
      if (ex.equipment_required?.some((eq) => excludedEquipment.has(normalizeEquipment(eq)))) {
        bannedIds.add(ex.id)
      }
    }
  }

  // An explicit ban always beats an unlock.
  for (const id of bannedIds) unlockedIds.delete(id)

  return { unlockedIds, bannedIds, matched, unmatched }
}

/**
 * Words that flip the polarity of a request. When any appear, the deterministic
 * fallback refuses to guess: unlocking "barbell" out of "NO barbell back squats"
 * is worse than doing nothing, so it degrades to current behaviour instead.
 */
const NEGATION_TOKENS = [
  "no ", "not ", "non-", "avoid", "without", "exclude", "never",
  "minimi", "skip", "don't", "dont", "limit", "reduce", "less ",
]

export function fallbackIntent(instructions: string): InstructionIntent {
  const lower = instructions.toLowerCase()
  if (NEGATION_TOKENS.some((t) => lower.includes(t))) return EMPTY_INTENT

  const found = new Set<string>()
  for (const term of CANONICAL_EQUIPMENT) {
    const pattern = new RegExp(`\\b${term.replace(/_/g, "[ _]")}s?\\b`)
    if (pattern.test(lower)) found.add(term)
  }
  return { ...EMPTY_INTENT, required_equipment: [...found] }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions; npx vitest run src/ai/__tests__/instruction-intent.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/instruction-intent.ts functions/src/ai/__tests__/instruction-intent.test.ts functions/src/ai/validate.ts
git commit -m "feat(ai): intent resolution — map coach instruction phrases to exercise ids"
```

---

### Task 2: Haiku extraction with graceful fallback

**Files:**
- Modify: `functions/src/ai/instruction-intent.ts`
- Test: `functions/src/ai/__tests__/instruction-intent.test.ts`

**Interfaces:**
- Consumes: `callAgent`, `MODEL_HAIKU` from `./anthropic.js`; `instructionIntentSchema`, `EMPTY_INTENT`, `fallbackIntent` from Task 1
- Produces: `extractInstructionIntent(instructions: string | undefined, opts?: { signal?: AbortSignal }): Promise<InstructionIntent>`

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/ai/__tests__/instruction-intent.test.ts`. The mock must be hoisted, so add this near the top imports:

```ts
import { vi } from "vitest"

const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))
```

and this describe block at the end:

```ts
import { extractInstructionIntent } from "../instruction-intent.js"

describe("extractInstructionIntent", () => {
  beforeEach(() => callAgentMock.mockReset())

  it("makes no AI call for empty instructions", async () => {
    expect(await extractInstructionIntent(undefined)).toEqual(EMPTY_INTENT)
    expect(await extractInstructionIntent("   ")).toEqual(EMPTY_INTENT)
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("normalizes equipment slugs returned by the model", async () => {
    callAgentMock.mockResolvedValue({
      content: {
        required_equipment: ["Dumbbells", "bb"],
        excluded_equipment: [],
        named_exercises: ["  Back Squat "],
        excluded_exercises: [],
      },
      tokens_used: 100,
    })
    const intent = await extractInstructionIntent("use dumbbells and barbell")
    expect(intent.required_equipment).toEqual(expect.arrayContaining(["dumbbell", "barbell"]))
    expect(intent.named_exercises).toEqual(["Back Squat"])
  })

  it("falls back deterministically when the model call throws", async () => {
    callAgentMock.mockRejectedValue(new Error("529 overloaded"))
    const intent = await extractInstructionIntent("use barbell for the main lifts")
    expect(intent.required_equipment).toContain("barbell")
  })

  it("falls back to EMPTY_INTENT when the model fails on negated text", async () => {
    callAgentMock.mockRejectedValue(new Error("529 overloaded"))
    expect(await extractInstructionIntent("avoid barbell entirely")).toEqual(EMPTY_INTENT)
  })
})
```

Add `beforeEach` to the vitest import list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions; npx vitest run src/ai/__tests__/instruction-intent.test.ts`
Expected: FAIL — `extractInstructionIntent` is not exported.

- [ ] **Step 3: Implement extraction**

Append to `functions/src/ai/instruction-intent.ts`:

```ts
import { callAgent, MODEL_HAIKU } from "./anthropic.js"

const INSTRUCTION_INTENT_PROMPT = `You extract structured constraints from a strength coach's free-text program instructions. You do NOT design programs and you do NOT judge the instructions — you only report what the coach explicitly asked for.

Return four lists:

- required_equipment: equipment the coach explicitly wants used.
- excluded_equipment: equipment the coach explicitly wants avoided.
- named_exercises: specific exercises or exercise families the coach explicitly asked FOR. Use the coach's own words ("bench press", "Olympic lifts", "med ball throws"). Include a family name when the coach names a category rather than one lift.
- excluded_exercises: specific exercises or families the coach explicitly wants avoided.

POLARITY IS THE ENTIRE POINT. "No barbell back squats" means excluded, NOT required. "Minimize bilateral pressing" means excluded. "Avoid overhead work" means excluded. Read each clause's polarity before assigning it to a list. Getting this backwards is the single worst failure you can make.

Only report what is EXPLICITLY stated. Do not infer equipment from an exercise name (do NOT add "barbell" just because the coach said "bench press" — the exercise name alone is enough). Do not add exercises the coach did not mention. If the instructions describe only sets, reps, tempo, rest, periodization, or session ordering, return four empty lists.

Normalize equipment to this vocabulary where possible: ${CANONICAL_EQUIPMENT.join(", ")}.`

function normalizeIntent(raw: InstructionIntent): InstructionIntent {
  const clean = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))]
  return {
    required_equipment: [...new Set(clean(raw.required_equipment).map(normalizeEquipment))],
    excluded_equipment: [...new Set(clean(raw.excluded_equipment).map(normalizeEquipment))],
    named_exercises: clean(raw.named_exercises),
    excluded_exercises: clean(raw.excluded_exercises),
  }
}

/**
 * Turn free-text coach instructions into structured overrides.
 *
 * Never throws and never blocks generation: an API failure degrades to the
 * deterministic fallback, which itself refuses to act on negated text.
 */
export async function extractInstructionIntent(
  instructions: string | undefined,
  opts?: { signal?: AbortSignal },
): Promise<InstructionIntent> {
  if (!instructions || instructions.trim().length === 0) return EMPTY_INTENT

  try {
    const result = await callAgent<InstructionIntent>(
      INSTRUCTION_INTENT_PROMPT,
      `Coach instructions:\n${instructions}`,
      instructionIntentSchema,
      { model: MODEL_HAIKU, maxTokens: 2000, signal: opts?.signal },
    )
    const intent = normalizeIntent(result.content)
    console.log(
      `[instruction-intent] extracted — require: [${intent.required_equipment.join(", ")}], ` +
        `exclude: [${intent.excluded_equipment.join(", ")}], ` +
        `named: ${intent.named_exercises.length}, excluded: ${intent.excluded_exercises.length}`,
    )
    return intent
  } catch (e) {
    console.warn(
      "[instruction-intent] extraction failed, using deterministic fallback:",
      e instanceof Error ? e.message : e,
    )
    return fallbackIntent(instructions)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions; npx vitest run src/ai/__tests__/instruction-intent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/instruction-intent.ts functions/src/ai/__tests__/instruction-intent.test.ts
git commit -m "feat(ai): Haiku extraction pass for coach instruction intent"
```

---

### Task 3: Make the input filters honour unlocked exercises

**Files:**
- Modify: `functions/src/ai/exercise-context.ts`
- Test: `functions/src/ai/__tests__/exercise-context.test.ts` (create if absent)

**Interfaces:**
- Produces (all trailing-optional, so existing callers are unaffected):
  - `filterByAvailableEquipment(exercises, availableEquipment, unlockedIds?: Set<string>)`
  - `filterByDifficultyLevel(exercises, clientDifficulty, unlockedIds?: Set<string>)`
  - `filterByProgressionPhase(exercises, clientDifficulty, weekNumber, unlockedIds?: Set<string>)`
  - `filterByDifficultyScore` — signature UNCHANGED (assessment ceiling is absolute)

- [ ] **Step 1: Write the failing tests**

Create `functions/src/ai/__tests__/exercise-context.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  filterByAvailableEquipment,
  filterByDifficultyLevel,
  filterByDifficultyScore,
  filterByProgressionPhase,
} from "../exercise-context.js"
import type { CompressedExercise } from "../types.js"

function ex(id: string, o: Partial<CompressedExercise> = {}): CompressedExercise {
  return {
    id, name: id, category: ["strength"], difficulty: "intermediate", difficulty_score: 5,
    muscle_group: "quads", movement_pattern: "squat", primary_muscles: ["quads"],
    secondary_muscles: [], force_type: "push", laterality: "bilateral",
    equipment_required: [], is_bodyweight: false, training_intent: ["build"],
    sport_tags: [], plane_of_motion: ["sagittal"], joints_loaded: [], ...o,
  } as CompressedExercise
}

// The exact production scenario: no client profile, so availableEquipment is []
// and clientDifficulty defaults to "beginner". Back Squat is cut twice over.
const BACK_SQUAT = ex("bs", { equipment_required: ["barbell"], difficulty: "intermediate", difficulty_score: 6 })
const PUSH_UP = ex("pu", { equipment_required: [], is_bodyweight: true, difficulty: "beginner", difficulty_score: 2 })

describe("filterByAvailableEquipment", () => {
  it("drops barbell work when no equipment is known", () => {
    const out = filterByAvailableEquipment([BACK_SQUAT, PUSH_UP], [])
    expect(out.map((e) => e.id)).toEqual(["pu"])
  })

  it("keeps an unlocked exercise despite unavailable equipment", () => {
    const out = filterByAvailableEquipment([BACK_SQUAT, PUSH_UP], [], new Set(["bs"]))
    expect(out.map((e) => e.id)).toEqual(["bs", "pu"])
  })
})

describe("filterByDifficultyLevel", () => {
  it("drops intermediate work for a beginner", () => {
    expect(filterByDifficultyLevel([BACK_SQUAT, PUSH_UP], "beginner").map((e) => e.id)).toEqual(["pu"])
  })

  it("keeps an unlocked exercise above the client's tier", () => {
    const out = filterByDifficultyLevel([BACK_SQUAT, PUSH_UP], "beginner", new Set(["bs"]))
    expect(out.map((e) => e.id)).toEqual(["bs", "pu"])
  })
})

describe("filterByProgressionPhase", () => {
  it("keeps an unlocked exercise in week 1 where progression has not unlocked", () => {
    const out = filterByProgressionPhase([BACK_SQUAT, PUSH_UP], "beginner", 1, new Set(["bs"]))
    expect(out.map((e) => e.id)).toEqual(["bs", "pu"])
  })
})

describe("filterByDifficultyScore", () => {
  it("is NOT bypassable — the assessment ceiling is measured evidence", () => {
    // No unlockedIds parameter exists by design; an unlocked exercise above the
    // assessed ceiling must still be cut.
    expect(filterByDifficultyScore([BACK_SQUAT, PUSH_UP], 4).map((e) => e.id)).toEqual(["pu"])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions; npx vitest run src/ai/__tests__/exercise-context.test.ts`
Expected: FAIL — the unlock cases fail (extra argument ignored, exercise still filtered out).

- [ ] **Step 3: Add the optional parameter to the three bypassable filters**

In `functions/src/ai/exercise-context.ts`:

`filterByDifficultyLevel` — add the parameter and an early keep:

```ts
export function filterByDifficultyLevel(
  exercises: CompressedExercise[],
  clientDifficulty: string,
  unlockedIds?: Set<string>,
): CompressedExercise[] {
  const clientIdx = DIFFICULTY_LEVELS.indexOf(clientDifficulty as DifficultyLevel)
  if (clientIdx === -1) return exercises
  return exercises.filter((ex) => {
    if (unlockedIds?.has(ex.id)) return true
    const exIdx = DIFFICULTY_LEVELS.indexOf(ex.difficulty as DifficultyLevel)
    if (exIdx === -1) return true
    return exIdx <= clientIdx
  })
}
```

`filterByProgressionPhase` — same treatment; insert `if (unlockedIds?.has(ex.id)) return true` as the first line of the `.filter` callback, and add `unlockedIds?: Set<string>` as the fourth parameter.

`filterByAvailableEquipment` — same; insert `if (unlockedIds?.has(ex.id)) return true` as the first line of the `.filter` callback, and add `unlockedIds?: Set<string>` as the third parameter.

Leave `filterByDifficultyScore` completely untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions; npx vitest run src/ai/__tests__/exercise-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/exercise-context.ts functions/src/ai/__tests__/exercise-context.test.ts
git commit -m "feat(ai): let unlocked exercises bypass the guessed equipment and tier filters"
```

---

### Task 4: Real similarity scores, seeded jitter, and MMR that actually runs

**Files:**
- Modify: `functions/src/ai/exercise-filter.ts`
- Test: `functions/src/ai/__tests__/exercise-filter.test.ts`

**Interfaces:**
- Produces:
  - `FilterOptions.seed?: string` (new field)
  - `seededJitter(seed: string | undefined, exerciseId: string, range?: number): number`
  - `scoreAndFilterExercises` / `semanticFilterExercises` signatures unchanged

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/ai/__tests__/exercise-filter.test.ts`:

```ts
import { seededJitter } from "../exercise-filter.js"

describe("seededJitter", () => {
  it("returns 0 with no seed, so behaviour is unchanged when seeding is off", () => {
    expect(seededJitter(undefined, "ex-1")).toBe(0)
  })

  it("is deterministic for the same (seed, exercise)", () => {
    expect(seededJitter("run-a", "ex-1")).toBe(seededJitter("run-a", "ex-1"))
  })

  it("differs across seeds and across exercises", () => {
    expect(seededJitter("run-a", "ex-1")).not.toBe(seededJitter("run-b", "ex-1"))
    expect(seededJitter("run-a", "ex-1")).not.toBe(seededJitter("run-a", "ex-2"))
  })

  it("stays inside the requested range", () => {
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(seededJitter("s", `ex-${i}`, 8))).toBeLessThanOrEqual(8)
    }
  })
})

describe("MMR at the call site (regression: diversifyByMMR was a no-op)", () => {
  // 120 candidates against a 120-exercise library gives maxExercises = 80,
  // so truncation happens and MMR has something to choose between.
  const many: CompressedExercise[] = Array.from({ length: 120 }, (_, i) =>
    ex(`ex-${i}`, {
      movement_pattern: i % 2 === 0 ? "push" : "pull",
      primary_muscles: i % 2 === 0 ? ["chest"] : ["lats"],
      equipment_required: [],
      is_bodyweight: true,
    }),
  )

  it("changes which exercises survive truncation when mmrLambda is set", () => {
    const plain = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS)
    const mmr = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { mmrLambda: 0.7 })
    expect(plain.map((e) => e.id)).not.toEqual(mmr.map((e) => e.id))
  })

  it("pulls in the non-matching movement pattern that pure relevance ranks out", () => {
    const mmr = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { mmrLambda: 0.2 })
    // The skeleton only asks for "push"; a diversity-weighted selection must
    // still surface "pull" candidates.
    expect(mmr.some((e) => e.movement_pattern === "pull")).toBe(true)
  })
})

describe("seeded selection changes run to run", () => {
  const many: CompressedExercise[] = Array.from({ length: 120 }, (_, i) =>
    ex(`ex-${i}`, { equipment_required: [], is_bodyweight: true }),
  )

  it("produces identical output for the same seed", () => {
    const a = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { seed: "run-a" })
    const b = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { seed: "run-a" })
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id))
  })

  it("produces different ordering for different seeds", () => {
    const a = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { seed: "run-a" })
    const b = scoreAndFilterExercises(many, SKELETON, [], ANALYSIS, { seed: "run-b" })
    expect(a.map((e) => e.id)).not.toEqual(b.map((e) => e.id))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions; npx vitest run src/ai/__tests__/exercise-filter.test.ts`
Expected: FAIL — `seededJitter` not exported; the MMR test fails because MMR is a no-op; the seed tests fail because `seed` is ignored.

- [ ] **Step 3: Add the seeded jitter helper**

Add near the top of `functions/src/ai/exercise-filter.ts`, after the existing scoring constants:

```ts
/** Score offset applied per (run, exercise) so tie groups reshuffle each run. */
const JITTER_RANGE = 8

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(a: number): number {
  let t = (a += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Deterministic per-(seed, exercise) score offset in [-range, +range].
 *
 * Large enough to reshuffle near-ties — which is most of the list once base
 * scores cluster — small enough that a genuine relevance gap still wins. With
 * no seed this returns 0, so unseeded callers keep their previous ordering.
 */
export function seededJitter(seed: string | undefined, exerciseId: string, range = JITTER_RANGE): number {
  if (!seed) return 0
  return (mulberry32(hashString(`${seed}:${exerciseId}`)) - 0.5) * 2 * range
}
```

Add `seed?: string` to `FilterOptions` with a doc comment:

```ts
  /**
   * Per-run seed (the ai_generation_log row id). Drives deterministic tie-break
   * jitter so two identical requests produce different programs while any single
   * run stays reproducible from its logged id.
   */
  seed?: string
```

- [ ] **Step 4: Rework the tail of `scoreAndFilterExercises`**

Replace the block from `const sorted = [...exercises].sort(...)` through the `ensurePatternBalance` call with:

```ts
  const excludeIds = options?.excludeIds
  const candidates = excludeIds && excludeIds.size > 0 ? exercises.filter((e) => !excludeIds.has(e.id)) : exercises

  const scoredAll = candidates.map((e) => ({
    exercise: e,
    score: (exerciseMaxScores.get(e.id) ?? 0) + seededJitter(options?.seed, e.id),
  }))
  scoredAll.sort((a, b) => b.score - a.score)

  const cutoff = Math.min(maxExercises, scoredAll.length)
  const lambda = options?.mmrLambda
  // MMR must SELECT the survivors, not reorder an already-truncated list —
  // passing k === list length made diversifyByMMR return its input unchanged.
  const useMMR = lambda !== undefined && lambda < 1.0 && scoredAll.length > cutoff
  let filtered = useMMR
    ? diversifyByMMR(scoredAll, cutoff, lambda)
    : scoredAll.slice(0, cutoff).map((s) => s.exercise)

  if (!isPool && filtered.length < MIN_EXERCISES) filtered = scoredAll.map((s) => s.exercise)

  filtered = ensurePatternBalance(
    filtered,
    scoredAll.map((s) => s.exercise),
    skeleton,
    equipment,
    difficulty,
    { poolActive: isPool },
  )
```

Note the preferred/favorite boosts already applied into `exerciseMaxScores` above stay exactly as they are.

- [ ] **Step 5: Rework `semanticFilterExercises` to keep similarity and select via MMR**

Change the match collection from a `Set` to a score map:

```ts
  const matchScores = new Map<string, number>()
  for (const slot of slotGroups.values()) {
    try {
      const queryText = slotToText(slot)
      const queryEmbedding = await embedText(queryText)
      const { data } = await supabase.rpc("match_exercises", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_threshold: 0.15,
        match_count: isPool ? Math.max(matchCountPerSlot, exercises.length) : matchCountPerSlot,
      })
      for (const match of data ?? []) {
        if (poolIdSet && !poolIdSet.has(match.id)) continue
        // match_exercises returns (id, similarity). Keeping the similarity is
        // what gives the ranker a real relevance signal instead of a constant.
        const sim = typeof match.similarity === "number" ? match.similarity : 0
        const prev = matchScores.get(match.id)
        if (prev === undefined || sim > prev) matchScores.set(match.id, sim)
      }
    } catch (err) {
      console.warn(
        `[semanticFilter] Embedding search failed for slot ${slot.slot_id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
```

Update the two references that followed: `matchedIds.size` → `matchScores.size` (log line and the `minRequired` check), and `matchedIds.has(ex.id)` → `matchScores.has(ex.id)`. Add `seed: options?.seed` to the `scoreAndFilterExercises` fallback call's option object.

Then replace everything from the `const coachUsage = ...` re-rank block through the `ensurePatternBalance` call with:

```ts
  const coachUsage = options?.coachUsage ?? new Map<string, number>()
  const clientUsage = options?.clientUsage ?? new Map<string, number>()
  const preferredIds = options?.preferredIds
  const hasPreferred = !!preferredIds && preferredIds.size > 0
  const favoriteIds = options?.favoriteIds
  const hasFavorites = !!favoriteIds && favoriteIds.size > 0

  // Inject any preferred-pool exercises the embeddings ranked out, before
  // scoring, so the boost can act on them.
  if (hasPreferred) {
    const inFiltered = new Set(filtered.map((e) => e.id))
    const missingPreferred = exercises.filter((e) => preferredIds!.has(e.id) && !inFiltered.has(e.id))
    if (missingPreferred.length > 0) {
      console.log(`[semanticFilter] Injecting ${missingPreferred.length} preferred-pool exercises missed by embeddings`)
      filtered = [...missingPreferred, ...filtered]
    }
  }

  // Similarity is the relevance term; a preferred-pool injection that never
  // matched has no similarity, so it falls back to the neutral midpoint.
  const scoredAll = filtered.map((e) => ({
    exercise: e,
    score:
      applyUsagePenalty((matchScores.get(e.id) ?? 0.5) * 100, e.id, coachUsage, clientUsage) +
      (hasPreferred && preferredIds!.has(e.id) ? POOL_PREFERENCE_BOOST : 0) +
      (hasFavorites && favoriteIds!.has(e.id) ? FAVORITE_BOOST : 0) +
      seededJitter(options?.seed, e.id),
  }))
  scoredAll.sort((a, b) => b.score - a.score)

  const cutoff = Math.min(maxExercises, scoredAll.length)
  const lambda = options?.mmrLambda
  const useMMR = lambda !== undefined && lambda < 1.0 && scoredAll.length > cutoff
  filtered = useMMR
    ? diversifyByMMR(scoredAll, cutoff, lambda)
    : scoredAll.slice(0, cutoff).map((s) => s.exercise)

  console.log(
    `[semanticFilter] Ranked ${scoredAll.length} candidates by similarity` +
      `${options?.seed ? " (seeded)" : ""}${useMMR ? ` + MMR λ=${lambda}` : ""} → ${filtered.length}`,
  )

  const balancePool =
    options?.excludeIds && options.excludeIds.size > 0
      ? exercises.filter((e) => !options.excludeIds!.has(e.id))
      : exercises
  filtered = ensurePatternBalance(filtered, balancePool, skeleton, equipment, difficulty, { poolActive: isPool })
```

Delete the now-superseded standalone `if (filtered.length > maxExercises) filtered = filtered.slice(0, maxExercises)` line and the old trailing MMR block.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd functions; npx vitest run src/ai/__tests__/exercise-filter.test.ts`
Expected: PASS, including the pre-existing `applyUsagePenalty`, `diversifyByMMR`, `favoriteIds` and `excludeIds` suites.

- [ ] **Step 7: Commit**

```bash
git add functions/src/ai/exercise-filter.ts functions/src/ai/__tests__/exercise-filter.test.ts
git commit -m "fix(ai): use embedding similarity, seed tie-breaks, and make MMR actually select"
```

---

### Task 5: Validator agreement and a stable, complete library read

**Files:**
- Modify: `functions/src/ai/schemas.ts:222-263`
- Modify: `functions/src/ai/program-chat-tools.ts:77-106`
- Test: `functions/src/ai/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `validateAssignmentAgainstCeiling(assignment, difficultyCeiling, slotInWeek, exerciseLibrary, unlockedIds?: Set<string>)`

- [ ] **Step 1: Write the failing test**

Append to `functions/src/ai/__tests__/schemas.test.ts`:

```ts
describe("validateAssignmentAgainstCeiling — unlocked exemption", () => {
  const ceiling = [{ week_number: 1, max_tier: "beginner", max_score: 4 }]
  const slotInWeek = new Map([["w1d1s1", 1]])
  const library = [{ id: "bs", difficulty: "intermediate", difficulty_score: 6 }]
  const assignment = {
    assignments: [{ slot_id: "w1d1s1", exercise_id: "bs", exercise_name: "Back Squat", notes: null }],
    substitution_notes: [],
  }

  it("flags an over-ceiling exercise by default", () => {
    const r = validateAssignmentAgainstCeiling(assignment as never, ceiling as never, slotInWeek, library)
    expect(r.ok).toBe(false)
  })

  it("exempts an unlocked exercise, so the coach's named lift does not churn retries", () => {
    const r = validateAssignmentAgainstCeiling(
      assignment as never, ceiling as never, slotInWeek, library, new Set(["bs"]),
    )
    expect(r.ok).toBe(true)
  })
})
```

Ensure `validateAssignmentAgainstCeiling` is in that file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions; npx vitest run src/ai/__tests__/schemas.test.ts`
Expected: FAIL on the exemption case — `ok` is `false`.

- [ ] **Step 3: Add the exemption**

In `functions/src/ai/schemas.ts`, add the fifth parameter and skip unlocked assignments:

```ts
export function validateAssignmentAgainstCeiling(
  assignment: z.infer<typeof exerciseAssignmentSchema>,
  difficultyCeiling: DifficultyCeilingWeek[],
  slotInWeek: Map<string, number>,
  exerciseLibrary: Array<{ id: string; difficulty: string; difficulty_score: number | null | undefined }>,
  unlockedIds?: Set<string>,
): ValidatorResult {
```

and, as the first statement inside the `for (const a of assignment.assignments)` loop:

```ts
    // Coach explicitly named this exercise. Agent 1 derives difficulty_ceiling
    // from the profile, so without this the ceiling rejects the very exercise
    // the input filters were told to admit — three identical retries, then a
    // failed generation.
    if (unlockedIds?.has(a.exercise_id)) continue
```

- [ ] **Step 4: Make the library read stable and unbounded**

Replace the body of `getExercisesForAI` in `functions/src/ai/program-chat-tools.ts` with a keyset-paginated, id-ordered read. `.order("id")` makes run-to-run ordering deterministic so seeded jitter is the only source of variation; pagination removes the 1000-row PostgREST cap that 922 active exercises are already at 92% of.

```ts
const EXERCISE_AI_COLUMNS =
  "id, name, category, difficulty, difficulty_score, muscle_group, movement_pattern, primary_muscles, secondary_muscles, force_type, laterality, equipment_required, is_bodyweight, training_intent, sport_tags, plane_of_motion, joints_loaded"

const EXERCISE_PAGE_SIZE = 1000

export async function getExercisesForAI(): Promise<CompressedExercise[]> {
  const supabase = getSupabase()
  const rows: Array<Record<string, unknown>> = []
  let cursor: string | null = null

  for (;;) {
    let query = supabase
      .from("exercises")
      .select(EXERCISE_AI_COLUMNS)
      .eq("is_active", true)
      .order("id", { ascending: true })
      .limit(EXERCISE_PAGE_SIZE)
    if (cursor) query = query.gt("id", cursor)

    const { data, error } = await query
    if (error) throw new Error(`Failed to fetch exercises: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...(data as Array<Record<string, unknown>>))
    if (data.length < EXERCISE_PAGE_SIZE) break
    cursor = data[data.length - 1].id as string
  }

  return rows.map((ex) => ({
    id: ex.id as string,
    name: ex.name as string,
    category: (ex.category as string[]) ?? [],
    difficulty: (ex.difficulty as string) ?? "intermediate",
    difficulty_score: (ex.difficulty_score as number | null) ?? null,
    muscle_group: (ex.muscle_group as string | null) ?? null,
    movement_pattern: (ex.movement_pattern as string | null) ?? null,
    primary_muscles: (ex.primary_muscles as string[]) ?? [],
    secondary_muscles: (ex.secondary_muscles as string[]) ?? [],
    force_type: (ex.force_type as string | null) ?? null,
    laterality: (ex.laterality as string | null) ?? null,
    equipment_required: (ex.equipment_required as string[]) ?? [],
    is_bodyweight: (ex.is_bodyweight as boolean) ?? false,
    training_intent: (ex.training_intent as string[]) ?? ["build"],
    sport_tags: (ex.sport_tags as string[]) ?? [],
    plane_of_motion: (ex.plane_of_motion as string[]) ?? [],
    joints_loaded: (ex.joints_loaded as CompressedExercise["joints_loaded"]) ?? [],
  })) as CompressedExercise[]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions; npx vitest run src/ai/__tests__/schemas.test.ts src/ai/__tests__/exercise-context.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/schemas.ts functions/src/ai/program-chat-tools.ts functions/src/ai/__tests__/schemas.test.ts
git commit -m "fix(ai): exempt unlocked exercises from the ceiling check; paginate + order the library read"
```

---

### Task 6: Wire intent through both orchestrators

**Files:**
- Modify: `functions/src/ai/orchestrator.ts`
- Modify: `functions/src/ai/week-orchestrator.ts`
- Test: `functions/src/ai/__tests__/week-orchestrator.test.ts` (extend if it already covers the filter wiring)

**Interfaces:**
- Consumes: everything produced by Tasks 1–5.

- [ ] **Step 1: Import in `orchestrator.ts`**

```ts
import { extractInstructionIntent, resolveIntentToExerciseIds } from "./instruction-intent.js"
```

- [ ] **Step 2: Extract intent in parallel with Agent 1**

`combinedInstructions` is already computed at `orchestrator.ts:324`, above the `Promise.all`. Add extraction as a sixth parallel task so it costs no extra wall-clock:

```ts
    const [agent1Result, allExercises, coachUsage, clientUsage, favoriteIds, instructionIntent] = await Promise.all([
      callAgent<ProfileAnalysis>(augmentedAgent1Prompt, agent1UserMessage, profileAnalysisSchema, {
        model: MODEL_SONNET,
        cacheSystemPrompt: true,
      }),
      getExercisesForAI(),
      getCoachRecentUsageFromFn(requestedBy, 60).catch((e) => {
        console.warn("[orchestrator:sync] coach usage fetch failed:", e instanceof Error ? e.message : e)
        return new Map<string, number>()
      }),
      request.client_id
        ? getClientRecentUsageFromFn(request.client_id, 90).catch((e) => {
            console.warn("[orchestrator:sync] client usage fetch failed:", e instanceof Error ? e.message : e)
            return new Map<string, number>()
          })
        : Promise.resolve(new Map<string, number>()),
      favoritesEnabled && request.client_id
        ? getClientFavoriteExerciseIds(request.client_id).catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
      extractInstructionIntent(combinedInstructions),
    ])
```

- [ ] **Step 3: Resolve the intent right after `allCompressed` is defined**

Immediately below `const allCompressed = allExercises`:

```ts
    // Coach instructions become concrete unlock/ban sets against the FULL
    // library, before any filtering narrows it.
    const intentResolution = resolveIntentToExerciseIds(instructionIntent, allCompressed)
    const unlockedIds = intentResolution.unlockedIds
    console.log(
      `[orchestrator:sync] Instruction intent: ${unlockedIds.size} unlocked, ${intentResolution.bannedIds.size} banned` +
        (intentResolution.unmatched.length > 0 ? `, unmatched: ${intentResolution.unmatched.join("; ")}` : ""),
    )
```

- [ ] **Step 4: Apply unlocks and the widened equipment set to the filters**

Change the difficulty filter line (`orchestrator.ts:421`) to pass unlocks:

```ts
    let compressed = poolActive ? poolFiltered : filterByDifficultyLevel(poolFiltered, clientDifficultyLevel, unlockedIds)
```

Immediately after `const availableEquipment = ...` (`:441`), add the widened set and use it for both the filter and the validator:

```ts
    const availableEquipment = request.equipment_override ?? profile?.available_equipment ?? []
    // Equipment the coach explicitly asked for is treated as available. The
    // profile's list is a guess (often empty); the instruction is not.
    const effectiveEquipment = [...new Set([...availableEquipment, ...instructionIntent.required_equipment])]
    if (!poolActive) {
      const beforeCount = compressed.length
      compressed = filterByAvailableEquipment(compressed, effectiveEquipment, unlockedIds)
      if (compressed.length !== beforeCount) {
        console.log(
          `[orchestrator:sync] Equipment filter: ${beforeCount} → ${compressed.length} (available: ${effectiveEquipment.length > 0 ? effectiveEquipment.join(", ") : "none/bodyweight-only"})`,
        )
      }
    }
```

Record unlocked exercises the assessment ceiling still removed, after the `filterByDifficultyScore` call:

```ts
    const survivingIds = new Set(compressed.map((e) => e.id))
    const blockedByAssessment = [...unlockedIds].filter((id) => !survivingIds.has(id))
```

- [ ] **Step 5: Keep the validator in agreement**

Replace the `validatorEquipment` definition (`:469-471`) so unlocked exercises' own equipment counts as available — otherwise `validateProgram` raises `equipment_violation` errors against the exercises we just admitted:

```ts
    const unlockedEquipment = compressed.filter((e) => unlockedIds.has(e.id)).flatMap((e) => e.equipment_required)
    const validatorEquipment = poolActive
      ? [...new Set([...effectiveEquipment, ...compressed.flatMap((e) => e.equipment_required)])]
      : [...new Set([...effectiveEquipment, ...unlockedEquipment])]
```

Pass unlocks to the ceiling check (`:800-805`):

```ts
            const ceilingCheck = validateAssignmentAgainstCeiling(
              weekAssignment,
              analysis.difficulty_ceiling,
              slotInWeek,
              compressed.map((e) => ({ id: e.id, difficulty: e.difficulty, difficulty_score: e.difficulty_score })),
              unlockedIds,
            )
```

- [ ] **Step 6: Ban, seed, and diversify the candidate filter**

Update both `semanticFilterExercises` and `scoreAndFilterExercises` option objects (`:583-598`):

```ts
      const filterOptions = {
        poolActive,
        coachUsage,
        clientUsage,
        preferredIds,
        favoriteIds,
        excludeIds: intentResolution.bannedIds,
        seed: log.id,
        mmrLambda: 0.7,
      }
      try {
        filtered = await semanticFilterExercises(compressed, skeleton, effectiveEquipment, analysis, filterOptions)
      } catch {
        filtered = scoreAndFilterExercises(compressed, skeleton, effectiveEquipment, analysis, filterOptions)
      }
```

Also change the per-week progression filter (`:654`) to pass unlocks:

```ts
      const thisWeekLibrary = poolActive
        ? filtered
        : filterByProgressionPhase(filtered, clientDifficultySync, weekNum, unlockedIds)
```

- [ ] **Step 7: Surface unmatched and blocked requests to the coach**

After the full-program `validateProgram` call, alongside the existing repetition warning:

```ts
    for (const phrase of intentResolution.unmatched) {
      validation.issues.push({
        type: "warning",
        category: "instruction_unmatched",
        message: `You asked for "${phrase}" but no exercise in the library matches it.`,
      })
    }
    for (const id of blockedByAssessment) {
      const ex = allCompressed.find((e) => e.id === id)
      validation.issues.push({
        type: "warning",
        category: "instruction_blocked_by_assessment",
        message: `"${ex?.name ?? id}" was requested but exceeds this client's assessed difficulty ceiling.`,
      })
    }
```

Add the resolved intent to `output_summary` in the `updateGenerationLog` call:

```ts
        instruction_intent: {
          required_equipment: instructionIntent.required_equipment,
          excluded_equipment: instructionIntent.excluded_equipment,
          unlocked_count: unlockedIds.size,
          banned_count: intentResolution.bannedIds.size,
          unmatched: intentResolution.unmatched,
          blocked_by_assessment: blockedByAssessment.length,
        },
```

- [ ] **Step 8: Mirror the wiring in `week-orchestrator.ts`**

Apply the same six changes, with two differences:

1. `excludeIds` already exists there (`resolveCrossDayExcludeIds`), so union rather than replace:
   ```ts
   const excludeIds = new Set([...resolveCrossDayExcludeIds(priorContext, VARIETY_ROLES, poolActive), ...intentResolution.bannedIds])
   ```
2. It already passes `mmrLambda: 0.7`; add `seed` and `excludeIds` to the same options object. Use the week-generation job/log id as the seed so each "AI Fill Week" press varies.

Locate its `filterByDifficultyLevel`, `filterByAvailableEquipment`, `availableEquipment`, and `validateAssignmentAgainstCeiling` call sites and apply the identical treatment. Extract the intent alongside its existing parallel fetches.

- [ ] **Step 9: Typecheck and run the full functions suite**

The orchestrators are cross-cutting, so this is the one place a full suite run is warranted.

Run: `cd functions; npx tsc --noEmit`
Expected: clean.

Run: `cd functions; npm test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add functions/src/ai/orchestrator.ts functions/src/ai/week-orchestrator.ts
git commit -m "feat(ai): wire instruction intent, seeding and MMR through both orchestrators"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `extractInstructionIntent` + Haiku prompt + fallback | 2 |
| `resolveIntentToExerciseIds` pure resolution | 1 |
| Name normalization / `_Muscle` suffix handling | 1 |
| Negation-guarded deterministic fallback | 1 (impl), 2 (wiring) |
| `filterByAvailableEquipment` unlockable | 3 |
| `filterByDifficultyLevel` unlockable | 3 |
| `filterByProgressionPhase` unlockable | 3 |
| `filterByDifficultyScore` NOT unlockable | 3 (asserted) |
| `filterByInjuredJoints` untouched | — (no change made) |
| `required_equipment` widens the equipment set | 6 |
| `validatorEquipment` includes unlocked equipment | 6 |
| `validateAssignmentAgainstCeiling` exemption | 5 |
| similarity kept from `match_exercises` | 4 |
| seeded jitter | 4 |
| MMR before truncation | 4 |
| `orchestrator.ts` passes `mmrLambda` | 6 |
| `.order("id")` + pagination | 5 |
| logging / `output_summary` / validation warnings | 6 |

**Placeholder scan:** no TBD/TODO; every code step carries real code.

**Type consistency:** `unlockedIds`/`bannedIds` are `Set<string>` at every boundary. `IntentResolution` field names (`unlockedIds`, `bannedIds`, `matched`, `unmatched`) are used identically in Tasks 1 and 6. `seed` is `string | undefined` in `FilterOptions`, `seededJitter`, and both orchestrator call sites. `filterByAvailableEquipment`'s new parameter is third; `filterByProgressionPhase`'s is fourth; `validateAssignmentAgainstCeiling`'s is fifth — matching each function's existing arity.
