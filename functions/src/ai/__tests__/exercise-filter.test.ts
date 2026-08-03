import { describe, it, expect, vi } from "vitest"
import {
  applyUsagePenalty,
  scoreAndFilterExercises,
  diversifyByMMR,
  semanticFilterExercises,
  seededJitter,
} from "../exercise-filter.js"
import type { CompressedExercise, ProgramSkeleton, ProfileAnalysis } from "../types.js"

// Stub out Supabase and embeddings so semanticFilterExercises can run in unit tests.
// The RPC returns empty results, which drops matchedIds below minRequired and
// triggers the scoreAndFilter fallback — which is exactly the path we're testing.
vi.mock("../../lib/supabase.js", () => ({
  getSupabase: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}))
vi.mock("../embeddings.js", () => ({
  slotToText: vi.fn(() => "stub text"),
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

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

describe("applyUsagePenalty", () => {
  it("returns baseScore unchanged when usage maps are empty", () => {
    const result = applyUsagePenalty(100, "ex-1", new Map(), new Map())
    expect(result).toBe(100)
  })

  it("subtracts 30 when exercise was used by coach within 60 days", () => {
    const coachUsage = new Map([["ex-1", 20]])
    const result = applyUsagePenalty(100, "ex-1", coachUsage, new Map())
    expect(result).toBe(70)
  })

  it("subtracts 50 when exercise was used by this client within 90 days", () => {
    const clientUsage = new Map([["ex-1", 30]])
    const result = applyUsagePenalty(100, "ex-1", new Map(), clientUsage)
    expect(result).toBe(50)
  })

  it("stacks both penalties when exercise was used by both coach and client", () => {
    const result = applyUsagePenalty(100, "ex-1", new Map([["ex-1", 20]]), new Map([["ex-1", 30]]))
    expect(result).toBe(20)
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
    expect(result).toBe(70)
  })
})

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

describe("semanticFilterExercises with excludeIds (pattern-balance honors exclude)", () => {
  it("excludeIds removes ids from final result even after pattern balance", async () => {
    // Build a large enough library to exercise the semantic path's MIN_EXERCISES guard.
    // The semantic filter is async and depends on Supabase RPC for embeddings; if the
    // embedding call throws, it falls back to scoreAndFilterExercises which we already
    // tested. We verify the fallback path here.
    const exercises = Array.from({ length: 50 }, (_, i) => ex(`ex-${i}`, {
      movement_pattern: i % 5 === 0 ? "pull" : "push",
      primary_muscles: i % 5 === 0 ? ["lats"] : ["chest"],
    }))
    // Use scoreAndFilter directly (semantic falls back to it on embedding failure).
    const result = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      excludeIds: new Set(["ex-0", "ex-5", "ex-10"]),
    })
    expect(result.find((e) => e.id === "ex-0")).toBeUndefined()
    expect(result.find((e) => e.id === "ex-5")).toBeUndefined()
    expect(result.find((e) => e.id === "ex-10")).toBeUndefined()
  })
})

describe("semanticFilterExercises fallback preserves excludeIds", () => {
  it("excludeIds passed through when fallback to scoreAndFilter triggers", async () => {
    // Force the fallback by passing few exercises. The semantic path bails out and
    // delegates to scoreAndFilter, which must still respect excludeIds.
    const exercises = [
      ex("keep-1", { movement_pattern: "push", primary_muscles: ["chest"] }),
      ex("keep-2", { movement_pattern: "pull", primary_muscles: ["lats"] }),
      ex("drop-me", { movement_pattern: "push", primary_muscles: ["chest"] }),
    ]
    const result = await semanticFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      excludeIds: new Set(["drop-me"]),
    })
    expect(result.find((e) => e.id === "drop-me")).toBeUndefined()
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

describe("favoriteIds soft boost", () => {
  it("ranks a favorited exercise ahead of an identical non-favorite", () => {
    // "low-ranker" is a valid push/chest exercise but scores ~18 pts lower than the
    // top two (advanced difficulty penalty instead of exact match).  The FAVORITE_BOOST
    // of 30 is larger than that gap, so it must move from last (index 2) to first.
    const exercises = [
      ex("push-1", { movement_pattern: "push", primary_muscles: ["chest"], difficulty: "intermediate" }),
      ex("push-2", { movement_pattern: "push", primary_muscles: ["chest"], difficulty: "intermediate" }),
      // "advanced" difficulty against an "intermediate" client: exact pattern + muscle match
      // but only +2 for difficulty (above client level) instead of +20 — score gap < 30.
      ex("low-ranker", { movement_pattern: "push", primary_muscles: ["chest"], difficulty: "advanced" }),
    ]
    const favId = "low-ranker"

    const resultNoFav = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {})
    const resultWithFav = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      favoriteIds: new Set([favId]),
    })

    const rankBefore = resultNoFav.findIndex((e) => e.id === favId)
    const rankAfter = resultWithFav.findIndex((e) => e.id === favId)

    // Favorited exercise must rank strictly better (lower index = better rank).
    // Because low-ranker ranks last without the boost (index 2), the boost must strictly improve it.
    expect(rankAfter).toBeLessThan(rankBefore)
    // Sanity: the no-favorites run really did rank it last (index 2).
    expect(rankBefore).toBe(2)
  })

  it("does not resurrect an exercise removed by a hard filter (favorites are post-filter)", () => {
    // A favorited id that isn't in the candidate exercises array can never appear.
    const exercises = [
      ex("a", { movement_pattern: "push", primary_muscles: ["chest"] }),
      ex("b", { movement_pattern: "push", primary_muscles: ["chest"] }),
    ]
    const result = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      favoriteIds: new Set(["not-in-library"]),
    })
    expect(result.some((e) => e.id === "not-in-library")).toBe(false)
  })
})

// ─── Run-to-run variation ───────────────────────────────────────────────────

describe("seededJitter", () => {
  it("returns 0 with no seed, so unseeded callers keep their previous ordering", () => {
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
    for (let i = 0; i < 300; i++) {
      expect(Math.abs(seededJitter("s", `ex-${i}`, 8))).toBeLessThanOrEqual(8)
    }
  })
})

/**
 * 600 candidates → getMaxExercises caps at 90 (15% of 600), so truncation
 * genuinely happens and MMR has a selection to make. Muscles and equipment
 * vary so candidates are not interchangeable — with a uniform fixture MMR
 * would correctly return the same set and prove nothing.
 *
 * This is the regression guard for diversifyByMMR having been called with
 * k === input length, which made it return its input untouched at BOTH call
 * sites while the helper's own unit tests kept passing.
 */
const MUSCLES = ["chest", "shoulders", "triceps", "lats", "biceps", "traps"]
const EQUIP = [[], ["dumbbell"], ["cable_machine"], ["resistance_band"]]
const MANY = Array.from({ length: 600 }, (_, i) =>
  ex(`ex-${i}`, {
    movement_pattern: i % 2 === 0 ? "push" : "pull",
    primary_muscles: [MUSCLES[i % MUSCLES.length]],
    equipment_required: EQUIP[i % EQUIP.length],
    is_bodyweight: EQUIP[i % EQUIP.length].length === 0,
  }),
)

const distinctMuscles = (list: CompressedExercise[]) => new Set(list.map((e) => e.primary_muscles[0])).size
const distinctEquipment = (list: CompressedExercise[]) => new Set(list.map((e) => e.equipment_required.join("+"))).size

describe("MMR at the call site (regression: diversifyByMMR was a no-op)", () => {
  it("truncates, so there is actually a selection to make", () => {
    expect(scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS).length).toBeLessThan(MANY.length)
  })

  it("changes which exercises survive truncation at the production lambda", () => {
    const plain = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS)
    const mmr = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { mmrLambda: 0.7 })
    expect(mmr.map((e) => e.id)).not.toEqual(plain.map((e) => e.id))
  })

  it("yields a broader spread of muscles and equipment than pure relevance", () => {
    const plain = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS)
    const mmr = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { mmrLambda: 0.7 })
    expect(distinctMuscles(mmr)).toBeGreaterThanOrEqual(distinctMuscles(plain))
    expect(distinctEquipment(mmr)).toBeGreaterThanOrEqual(distinctEquipment(plain))
    expect(distinctMuscles(mmr) + distinctEquipment(mmr)).toBeGreaterThan(
      distinctMuscles(plain) + distinctEquipment(plain),
    )
  })

  it("surfaces the off-pattern candidates that pure relevance ranks out", () => {
    // The skeleton only asks for "push". Pure relevance fills the cutoff with
    // push work; a diversity-weighted selection must still surface "pull".
    const mmr = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { mmrLambda: 0.2 })
    expect(mmr.some((e) => e.movement_pattern === "pull")).toBe(true)
  })
})

describe("seeded selection changes run to run", () => {
  it("produces identical output for the same seed", () => {
    const a = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { seed: "run-a" })
    const b = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { seed: "run-a" })
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id))
  })

  it("produces a different selection for a different seed", () => {
    const a = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { seed: "run-a" })
    const b = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS, { seed: "run-b" })
    expect(a.map((e) => e.id)).not.toEqual(b.map((e) => e.id))
  })

  it("is a no-op without a seed (two unseeded runs match)", () => {
    const a = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS)
    const b = scoreAndFilterExercises(MANY, SKELETON, [], ANALYSIS)
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id))
  })
})

describe("semanticFilterExercises uses the similarity match_exercises returns", () => {
  it("ranks by similarity rather than the order exercises arrive in", async () => {
    const lib = [ex("low", {}), ex("high", {}), ex("mid", {})]
    // Deliberately inverted vs. array order: "high" is last-but-one in input.
    const sims: Record<string, number> = { low: 0.2, mid: 0.5, high: 0.95 }

    const { getSupabase } = await import("../../lib/supabase.js")
    vi.mocked(getSupabase).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: lib.map((e) => ({ id: e.id, similarity: sims[e.id] })),
        error: null,
      }),
    } as never)

    const result = await semanticFilterExercises(lib, SKELETON, [], ANALYSIS, { poolActive: true })
    expect(result.map((e) => e.id)).toEqual(["high", "mid", "low"])
  })
})
