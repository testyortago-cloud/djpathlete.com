import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: supabaseFromMock }),
}))

type Row = {
  id: string
  weight_kg: number | null
  reps_completed: string | null
  sets_completed: number | null
  set_details: { set_number: number; reps: number; weight_kg: number; rpe: number | null }[] | null
}

function row(id: string, weightKg: number, reps = 5, sets = 4): Row {
  return {
    id,
    weight_kg: weightKg,
    reps_completed: String(reps),
    sets_completed: sets,
    set_details: Array.from({ length: sets }, (_, i) => ({
      set_number: i + 1,
      reps,
      weight_kg: weightKg,
      rpe: null,
    })),
  }
}

/**
 * Minimal stand-in for the PostgREST builder used by fetchExerciseHistory:
 *   .from(t).select("*").eq(..).eq(..)[.neq("id", x)].order(..) -> { data, error }
 * `neq` filters the fixture the way the real query would, so the test exercises
 * the exclusion rather than trusting that the call was made.
 */
function mockHistory(rows: Row[]) {
  const calls: { neq: [string, string][] } = { neq: [] }
  supabaseFromMock.mockImplementation(() => {
    let current = [...rows]
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      neq: (col: string, val: string) => {
        calls.neq.push([col, val])
        current = current.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val)
        return builder
      },
      order: () => Promise.resolve({ data: current, error: null }),
    }
    return builder
  })
  return calls
}

beforeEach(() => {
  supabaseFromMock.mockReset()
})

describe("detectPRs", () => {
  /**
   * Regression: the log route inserts the new set BEFORE calling detectPRs, so
   * the fetched history contains the new row. Comparing `new > max(history)`
   * then compares the set against itself and can never be true — every PR was
   * silently suppressed in production (achievements had 0 `pr` rows).
   */
  it("excludes the just-logged row so a heavier set is a PR", async () => {
    const calls = mockHistory([
      row("new-row", 42.5), // the row the route just inserted
      row("old-1", 40),
      row("old-2", 37.5),
    ])

    const { detectPRs } = await import("@/lib/pr-detection")
    const prs = await detectPRs(
      "user-1",
      "ex-1",
      "Bulgarian split squat",
      { weight_kg: 42.5, reps_completed: "5", sets_completed: 4, set_details: row("x", 42.5).set_details },
      "new-row",
    )

    expect(calls.neq).toContainEqual(["id", "new-row"])
    const weightPr = prs.find((p) => p.prType === "weight")
    expect(weightPr).toBeDefined()
    expect(weightPr!.isPr).toBe(true)
    expect(weightPr!.metricValue).toBe(42.5)
  })

  it("suppresses the PR when the new row is left in history (the original bug)", async () => {
    mockHistory([row("new-row", 42.5), row("old-1", 40)])

    const { detectPRs } = await import("@/lib/pr-detection")
    // No excludeProgressId -> history still contains the 42.5 row -> 42.5 > 42.5 is false.
    const prs = await detectPRs("user-1", "ex-1", "Bulgarian split squat", {
      weight_kg: 42.5,
      reps_completed: "5",
      sets_completed: 4,
      set_details: row("x", 42.5).set_details,
    })

    expect(prs.find((p) => p.prType === "weight")).toBeUndefined()
  })

  it("does not call a PR when the set is lighter than history", async () => {
    mockHistory([row("new-row", 35), row("old-1", 40)])

    const { detectPRs } = await import("@/lib/pr-detection")
    const prs = await detectPRs(
      "user-1",
      "ex-1",
      "Bulgarian split squat",
      { weight_kg: 35, reps_completed: "5", sets_completed: 4, set_details: row("x", 35).set_details },
      "new-row",
    )

    expect(prs.find((p) => p.prType === "weight")).toBeUndefined()
  })

  it("returns no PRs when there is no prior history", async () => {
    mockHistory([row("new-row", 42.5)])

    const { detectPRs } = await import("@/lib/pr-detection")
    const prs = await detectPRs(
      "user-1",
      "ex-1",
      "Bulgarian split squat",
      { weight_kg: 42.5, reps_completed: "5", sets_completed: 4, set_details: row("x", 42.5).set_details },
      "new-row",
    )

    expect(prs).toEqual([])
  })
})
