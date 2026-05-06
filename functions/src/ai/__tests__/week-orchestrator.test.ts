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
    await generateWeekSync(
      { program_id: "prog-1", client_id: "client-1" },
      "coach-1",
    ).catch(() => null) // ignore downstream Supabase failures; we're checking pre-generate fetches

    expect(getCoachPolicyMock).toHaveBeenCalledWith("coach-1")
    expect(getCoachUsageMock).toHaveBeenCalledWith("coach-1", 60)
    expect(getClientUsageMock).toHaveBeenCalledWith("client-1", 90)
  })
})
