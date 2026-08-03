// NOTE: deliberately no `beforeEach(() => callAgentMock.mockReset())`.
// Under vitest 2.1.9, mockReset() poisons a throwing mockImplementation set
// afterward — the throw surfaces as a spurious test failure even though the
// code under test catches it. Each test sets its own implementation instead.
import { describe, it, expect, vi } from "vitest"
import type { CompressedExercise } from "../types.js"

const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))

import {
  EMPTY_INTENT,
  extractInstructionIntent,
  fallbackIntent,
  normalizeExerciseName,
  resolveIntentToExerciseIds,
  significantTokens,
} from "../instruction-intent.js"

function ex(
  id: string,
  name: string,
  equipment: string[] = [],
  overrides: Partial<CompressedExercise> = {},
): CompressedExercise {
  return {
    id,
    name,
    category: ["strength"],
    difficulty: "intermediate",
    difficulty_score: 5,
    muscle_group: "chest",
    movement_pattern: "push",
    primary_muscles: ["chest"],
    secondary_muscles: [],
    force_type: "push",
    laterality: "bilateral",
    equipment_required: equipment,
    is_bodyweight: equipment.length === 0,
    training_intent: ["build"],
    sport_tags: [],
    plane_of_motion: ["sagittal"],
    joints_loaded: [],
    ...overrides,
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
    expect(normalizeExerciseName("Hip and Shoulder disassociation-Core")).toBe(
      "hip and shoulder disassociation core",
    )
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

  it("returns empty sets for an empty intent", () => {
    const r = resolveIntentToExerciseIds(EMPTY_INTENT, LIB)
    expect(r.unlockedIds.size).toBe(0)
    expect(r.bannedIds.size).toBe(0)
    expect(r.unmatched).toEqual([])
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

describe("extractInstructionIntent", () => {
  it("makes no AI call for empty instructions", async () => {
    callAgentMock.mockClear()
    expect(await extractInstructionIntent(undefined)).toEqual(EMPTY_INTENT)
    expect(await extractInstructionIntent("   ")).toEqual(EMPTY_INTENT)
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("normalizes equipment slugs returned by the model", async () => {
    // mockImplementation, not mockResolvedValue: under vitest 2.1.9 a
    // mockResolvedValue earlier in the file makes a later throwing
    // implementation surface as a spurious test failure.
    callAgentMock.mockImplementation(async () => ({
      content: {
        required_equipment: ["Dumbbells", "bb"],
        excluded_equipment: [],
        named_exercises: ["  Back Squat "],
        excluded_exercises: [],
      },
      tokens_used: 100,
    }))
    const intent = await extractInstructionIntent("use dumbbells and barbell")
    expect(intent.required_equipment).toEqual(expect.arrayContaining(["dumbbell", "barbell"]))
    expect(intent.named_exercises).toEqual(["Back Squat"])
  })

  const throwOnCall = () =>
    callAgentMock.mockImplementation(() => {
      throw new Error("529 overloaded")
    })

  it("falls back deterministically when the model call throws", async () => {
    throwOnCall()
    const intent = await extractInstructionIntent("use barbell for the main lifts")
    expect(intent.required_equipment).toContain("barbell")
  })

  it("falls back to EMPTY_INTENT when the model fails on negated text", async () => {
    throwOnCall()
    expect(await extractInstructionIntent("avoid barbell entirely")).toEqual(EMPTY_INTENT)
  })
})
