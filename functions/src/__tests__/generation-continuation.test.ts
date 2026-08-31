import { describe, it, expect } from "vitest"
import {
  canFitAnotherWeek,
  nextContinuationWeek,
  buildWeekContinuationInput,
  FINISH_RESERVE_MS,
  MAX_CONTINUATION_WEEKS,
} from "../ai/generation-continuation.js"

describe("canFitAnotherWeek", () => {
  it("always starts the first week — nothing has been measured yet", () => {
    // Refusing here would return an empty program AND leave nothing to
    // continue from, which is strictly worse than trying and failing.
    expect(canFitAnotherWeek(1_000, [])).toBe(true)
  })

  it("starts another week when the slowest week so far still fits with the reserve", () => {
    // Slowest 100s → budgeted 125s + 30s reserve = 155s.
    expect(canFitAnotherWeek(160_000, [80_000, 100_000])).toBe(true)
  })

  it("stops when the slowest week so far would not fit", () => {
    expect(canFitAnotherWeek(150_000, [80_000, 100_000])).toBe(false)
  })

  it("budgets for the SLOWEST week, not the most recent one", () => {
    // Later weeks carry more prior-week context, so a fast week 3 must not
    // talk us into starting a week we cannot finish.
    const remaining = 200_000
    expect(canFitAnotherWeek(remaining, [180_000, 60_000])).toBe(false)
    expect(canFitAnotherWeek(remaining, [60_000])).toBe(true)
  })

  it("keeps the finish reserve back so the partial-save writes still run", () => {
    // Exactly enough for the week itself, nothing left to record it with.
    expect(canFitAnotherWeek(100_000 * 1.25, [100_000], FINISH_RESERVE_MS)).toBe(false)
    expect(canFitAnotherWeek(100_000 * 1.25 + FINISH_RESERVE_MS, [100_000], FINISH_RESERVE_MS)).toBe(true)
  })
})

describe("nextContinuationWeek", () => {
  const meta = { final_week: 4, origin: "program_generation" as const }

  it("returns the week after the one just completed", () => {
    expect(nextContinuationWeek(2, meta)).toBe(3)
  })

  it("returns null once the final week is done", () => {
    expect(nextContinuationWeek(4, meta)).toBeNull()
  })

  it("returns null past the final week — never chains beyond the plan", () => {
    expect(nextContinuationWeek(5, meta)).toBeNull()
  })

  it("refuses to chain past the hard cap even if final_week is absurd", () => {
    const runaway = { final_week: 500, origin: "program_generation" as const }
    expect(nextContinuationWeek(MAX_CONTINUATION_WEEKS, runaway)).toBeNull()
  })

  it("returns null for a non-numeric completed week rather than chaining week NaN", () => {
    expect(nextContinuationWeek(undefined, meta)).toBeNull()
  })
})

describe("buildWeekContinuationInput", () => {
  const seed = {
    program_id: "prog-1",
    client_id: "client-1",
    admin_instructions: "12 exercises, 5 days",
    pool_exercise_ids: ["ex-1"],
    pool_mode: "preferred" as const,
    ignore_profile: false,
  }
  const meta = {
    final_week: 4,
    origin: "program_generation" as const,
    origin_log_id: "log-1",
    notify_email: "coach@example.com",
  }

  it("targets the requested week and carries the coach's instructions forward", () => {
    const input = buildWeekContinuationInput(seed, 3, meta, "coach-1")
    expect(input.request.program_id).toBe("prog-1")
    expect(input.request.target_week_number).toBe(3)
    expect(input.request.admin_instructions).toBe("12 exercises, 5 days")
    expect(input.request.pool_exercise_ids).toEqual(["ex-1"])
    expect(input.requestedBy).toBe("coach-1")
    expect(input.continuation).toEqual(meta)
  })

  it("generates the whole week, never a single day", () => {
    // target_day_of_week would silently narrow the continuation to one day and
    // leave the rest of the week blank forever.
    const input = buildWeekContinuationInput(seed, 3, meta, "coach-1")
    expect(input.request.target_day_of_week).toBeNull()
  })

  it("stays silent on intermediate weeks — one program, one 'it's ready' email", () => {
    expect(buildWeekContinuationInput(seed, 3, meta, "coach-1").notify_email).toBeNull()
  })

  it("emails on the final week", () => {
    expect(buildWeekContinuationInput(seed, 4, meta, "coach-1").notify_email).toBe("coach@example.com")
  })

  it("keeps the address on the continuation block so later links can still send", () => {
    // The per-job notify_email is nulled on intermediate weeks. If that were the
    // only copy, the first link would erase it and the final week would go out
    // silently — the coach would never learn their program finished.
    const week3 = buildWeekContinuationInput(seed, 3, meta, "coach-1")
    expect(week3.notify_email).toBeNull()
    expect(week3.continuation.notify_email).toBe("coach@example.com")

    // Feeding that link's own continuation block forward still emails at the end.
    const week4 = buildWeekContinuationInput(seed, 4, week3.continuation, "coach-1")
    expect(week4.notify_email).toBe("coach@example.com")
  })

  it("sends nothing when the coach asked for no email", () => {
    const silent = { ...meta, notify_email: null }
    expect(buildWeekContinuationInput(seed, 4, silent, "coach-1").notify_email).toBeNull()
  })
})
