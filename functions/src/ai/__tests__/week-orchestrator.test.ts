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
  getClientFavoriteExerciseIds: vi.fn(async () => new Set<string>()),
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
  const mockSingle = vi.fn().mockResolvedValue({
    data: {
      id: "prog-1",
      split_type: "full_body",
      periodization: "linear",
      duration_weeks: 4,
      sessions_per_week: 3,
    },
    error: null,
  })
  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnThis()
  return {
    getSupabase: () => ({
      from: () => ({
        select: mockSelect,
        eq: mockEq,
        order: mockOrder,
        single: mockSingle,
        insert: mockInsert,
        update: mockUpdate,
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }
})

describe("buildDedupSourceExercises", () => {
  function row(weekNumber: number, exerciseId: string) {
    return {
      exercise_id: exerciseId,
      week_number: weekNumber,
      order_index: 1,
      slot_role: "accessory",
      exercises: { name: exerciseId, movement_pattern: "push", primary_muscles: ["chest"] },
    }
  }

  it("keeps only weeks within the window, in both directions", async () => {
    const { buildDedupSourceExercises } = await import("../week-orchestrator.js")
    const existing = [
      row(1, "too-old"),
      row(4, "in-window-before"),
      row(10, "target-week-itself"),
      row(16, "in-window-after"),
      row(20, "too-new"),
    ]

    // Target week 10, window 6 → keeps weeks 4-16 inclusive, drops 1 and 20.
    const result = buildDedupSourceExercises(existing, 10, 6)

    expect(result.map((r) => r.exercise_id).sort()).toEqual(
      ["in-window-after", "in-window-before", "target-week-itself"].sort(),
    )
  })

  it("bounds context size regardless of how many weeks the program has run", async () => {
    const { buildDedupSourceExercises } = await import("../week-orchestrator.js")
    // A 20-week-deep program — full history would carry all 20 rows into the
    // dedup prompt; the window should cap it well below that no matter how
    // long the program gets.
    const existing = Array.from({ length: 20 }, (_, i) => row(i + 1, `ex-${i + 1}`))

    const result = buildDedupSourceExercises(existing, 20, 6)

    expect(result.length).toBeLessThan(existing.length)
    expect(result.length).toBe(7) // weeks 14-20 inclusive
  })

  it("maps role and slot_group the same way the previous full-history version did", async () => {
    const { buildDedupSourceExercises } = await import("../week-orchestrator.js")
    const existing = [
      {
        exercise_id: "ex-1",
        week_number: 5,
        order_index: 0,
        slot_role: null,
        exercises: { name: "Squat", movement_pattern: "squat", primary_muscles: ["quads", "glutes"] },
      },
    ]

    const result = buildDedupSourceExercises(existing, 5)

    expect(result).toEqual([
      {
        exercise_id: "ex-1",
        exercise_name: "Squat",
        week_number: 5,
        role: "warm_up", // order_index 0, no slot_role → inferred
        slot_group: "warm_up|squat|glutes,quads",
      },
    ])
  })
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
      .mockResolvedValueOnce({
        content: {
          recommended_split: "full_body",
          recommended_periodization: "linear",
          volume_targets: [{ muscle_group: "x", sets_per_week: 10, priority: "medium" }],
          exercise_constraints: [],
          session_structure: {
            warm_up_minutes: 5,
            main_work_minutes: 45,
            cool_down_minutes: 5,
            total_exercises: 4,
            compound_count: 2,
            isolation_count: 2,
          },
          training_age_category: "intermediate",
          technique_plan: [
            {
              week_number: 5,
              allowed_techniques: ["straight_set"],
              default_technique: "straight_set",
              notes: "",
            },
          ],
          difficulty_ceiling: [{ week_number: 5, max_tier: "intermediate", max_score: 6 }],
          notes: "",
        },
        tokens_used: 100,
      })
      .mockResolvedValueOnce({
        content: {
          weeks: [
            {
              week_number: 5,
              phase: "x",
              intensity_modifier: "moderate",
              days: [
                {
                  day_of_week: 1,
                  label: "L",
                  focus: "f",
                  slots: [
                    {
                      slot_id: "w5d1s1",
                      role: "primary_compound",
                      movement_pattern: "squat",
                      target_muscles: ["quads"],
                      sets: 3,
                      reps: "8",
                      rest_seconds: 90,
                      rpe_target: 7,
                      tempo: null,
                      group_tag: null,
                      technique: "straight_set",
                      intensity_pct: null,
                    },
                  ],
                },
              ],
            },
          ],
          split_type: "full_body",
          periodization: "linear",
          total_sessions: 1,
          notes: "",
        },
        tokens_used: 200,
      })
      .mockResolvedValueOnce({
        content: {
          assignments: [{ slot_id: "w5d1s1", exercise_id: "ex-1", exercise_name: "Squat", notes: null }],
          substitution_notes: [],
        },
        tokens_used: 50,
      })

    const { generateWeekSync } = await import("../week-orchestrator.js")
    await generateWeekSync({ program_id: "prog-1", client_id: "client-1" }, "coach-1").catch(() => null) // ignore downstream Supabase failures; we're checking pre-generate fetches

    expect(getCoachPolicyMock).toHaveBeenCalledWith("coach-1")
    expect(getCoachUsageMock).toHaveBeenCalledWith("coach-1", 60)
    expect(getClientUsageMock).toHaveBeenCalledWith("client-1", 90)
  })
})
