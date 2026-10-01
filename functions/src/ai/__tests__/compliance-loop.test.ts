import { describe, it, expect, vi } from "vitest"
import { runWithComplianceCheck, checkWithinBudget, SAVE_RESERVE_MS } from "../compliance-loop.js"
import {
  buildComplianceFeedback,
  type CheckInput,
  type InstructionCheck,
  type InstructionCheckItem,
} from "../instruction-check.js"
import { DeadlineExceededError } from "../../lib/deadline.js"

const item = (instruction: string, met: boolean, detail = "d"): InstructionCheckItem => ({
  instruction,
  met,
  detail,
  source: "code",
})
const mk = (items: InstructionCheckItem[], note: string | null = null): InstructionCheck => ({
  status: items.length === 0 ? "unchecked" : items.some((i) => !i.met) ? "failed" : "passed",
  items,
  rebuilt: false,
  rebuild_reason: null,
  note,
})

type A = { id: number; durationMs: number }
function setup(
  checks: Record<number, InstructionCheck>,
  opts: { remaining?: number | null; cancelled?: boolean } = {},
) {
  const build = vi.fn(async (fb: string | null): Promise<A> => ({ id: fb ? 2 : 1, durationMs: 1000 }))
  const check = vi.fn(async (a: A) => checks[a.id])
  const args = {
    build,
    check,
    remainingMs: () => (opts.remaining === undefined ? null : opts.remaining),
    isCancelled: async () => opts.cancelled ?? false,
  }
  return { build, check, args }
}

const failed1 = mk([item("A", false, "a1"), item("B", false, "b1"), item("C", true)])

describe("runWithComplianceCheck", () => {
  it("passed -> one build", async () => {
    const s = setup({ 1: mk([item("A", true)]) })
    const r = await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(r.attempt.id).toBe(1)
    expect(r.check.rebuilt).toBe(false)
  })

  it("unchecked -> one build", async () => {
    const s = setup({ 1: mk([]) })
    await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(1)
  })

  it("failed + time -> second build gets the feedback string", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", true), item("B", true)]) })
    const r = await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.build).toHaveBeenNthCalledWith(1, null)
    expect(s.build).toHaveBeenNthCalledWith(2, buildComplianceFeedback(failed1.items))
    expect(r.attempt.id).toBe(2)
    expect(r.check.rebuilt).toBe(true)
    expect(r.check.rebuild_reason).toBe("A: a1; B: b1")
  })

  it("fewer unmet wins", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", false), item("B", true)]) })
    expect((await runWithComplianceCheck(s.args)).attempt.id).toBe(2)
  })

  it("tie -> attempt 2", async () => {
    const s = setup({ 1: failed1, 2: mk([item("X", false), item("Y", false)]) })
    expect((await runWithComplianceCheck(s.args)).attempt.id).toBe(2)
  })

  it("worse attempt 2 -> attempt 1 kept but rebuilt: true", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", false), item("B", false), item("C", false)]) })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.rebuilt).toBe(true)
    expect(r.check.rebuild_reason).toBe("A: a1; B: b1")
    expect(failed1.rebuilt).toBe(false)
    expect(failed1.rebuild_reason).toBeNull()
  })

  it("not enough time -> one build + note", async () => {
    const s = setup({ 1: failed1 }, { remaining: 1299 })
    const r = await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(r.check.note).toBe("There wasn't time to rebuild, so this is the first attempt.")
    expect(r.check.rebuilt).toBe(false)
  })

  it("exactly 1.3x is enough time", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", true)]) }, { remaining: 1300 })
    await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(2)
  })

  it("keeps an existing note, joined with a space", async () => {
    const s = setup({ 1: { ...failed1, note: "Earlier." } }, { remaining: 0 })
    const r = await runWithComplianceCheck(s.args)
    expect(r.check.note).toBe("Earlier. There wasn't time to rebuild, so this is the first attempt.")
  })

  it("cancelled -> one build, attempt 1 check unchanged", async () => {
    const s = setup({ 1: failed1 }, { cancelled: true })
    const r = await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(r.check).toBe(failed1)
  })

  it("rebuild throws plain Error -> attempt 1 + note", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockImplementation(async (fb) => {
      if (fb) throw new Error("boom")
      return { id: 1, durationMs: 1000 }
    })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.note).toBe("A rebuild was attempted and failed, so this is the first attempt.")
  })

  // Running out of time must never throw away a finished first attempt: a
  // failed check never blocks the save (Ruling 6).
  const NO_TIME_REBUILD = "There wasn't time to finish the rebuild, so this is the first attempt."

  it("rebuild throws DeadlineExceededError -> attempt 1 kept + note, not rethrown", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockImplementation(async (fb) => {
      if (fb) throw new DeadlineExceededError("Day", "rebuild", 1000)
      return { id: 1, durationMs: 1000 }
    })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.items).toEqual(failed1.items)
    expect(r.check.rebuilt).toBe(false)
    expect(r.check.rebuild_reason).toBeNull()
    expect(r.check.note).toBe(NO_TIME_REBUILD)
  })

  it("rebuild throws AbortError -> attempt 1 kept + note", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockImplementation(async (fb) => {
      if (fb) throw Object.assign(new Error("x"), { name: "AbortError" })
      return { id: 1, durationMs: 1000 }
    })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.note).toBe(NO_TIME_REBUILD)
  })

  it("check of attempt 2 runs out of time -> attempt 1 kept + note, existing note kept", async () => {
    const s = setup({ 1: { ...failed1, note: "Earlier." } })
    s.check.mockImplementation(async (a: A) => {
      if (a.id === 2) throw new DeadlineExceededError("Day", "check", 1000)
      return { ...failed1, note: "Earlier." }
    })
    const r = await runWithComplianceCheck(s.args)
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(r.attempt.id).toBe(1)
    expect(r.check.rebuilt).toBe(false)
    expect(r.check.note).toBe(`Earlier. ${NO_TIME_REBUILD}`)
  })

  it("check of attempt 2 throws a plain Error -> attempt 1 + the rebuild-failed note", async () => {
    const s = setup({ 1: failed1 })
    s.check.mockImplementation(async (a: A) => {
      if (a.id === 2) throw new Error("boom")
      return failed1
    })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.note).toBe("A rebuild was attempted and failed, so this is the first attempt.")
  })

  // M3: the coach is told why the first attempt is the one they see.
  const MISSED_MORE = "The rebuild missed more, so the first attempt was kept."

  it("worse attempt 2 -> the note says the first attempt was kept", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", false), item("B", false), item("C", false)]) })
    expect((await runWithComplianceCheck(s.args)).check.note).toBe(MISSED_MORE)
  })

  it("worse attempt 2 -> the note is appended after an existing one, with a space", async () => {
    const s = setup({
      1: { ...failed1, note: "Earlier." },
      2: mk([item("A", false), item("B", false), item("C", false)]),
    })
    expect((await runWithComplianceCheck(s.args)).check.note).toBe(`Earlier. ${MISSED_MORE}`)
  })

  it("a kept rebuild gets no 'missed more' note (presence control)", async () => {
    const s = setup({ 1: failed1, 2: mk([item("A", true), item("B", true)]) })
    expect((await runWithComplianceCheck(s.args)).check.note).toBeNull()
  })

  it("attempt 1's own build error still propagates", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockRejectedValue(new DeadlineExceededError("Day", "architect", 1000))
    await expect(runWithComplianceCheck(s.args)).rejects.toBeInstanceOf(DeadlineExceededError)
  })
})

/**
 * I2: when the judge ran on attempt 1 but not on attempt 2 (skipped for time, or
 * failed), attempt 2's check has only code lines. Counting every unmet line
 * would then reward the rebuild for simply not being judged.
 */
describe("runWithComplianceCheck when only attempt 1 was judged by the AI", () => {
  const ai = (instruction: string, met: boolean, detail = "d"): InstructionCheckItem => ({
    instruction,
    met,
    detail,
    source: "ai",
  })
  const JUDGE_SKIPPED = "The AI check didn't run this time, so only the exact checks are shown."

  it("compares code lines only: a rebuild that breaks a code line loses even with fewer lines unmet", async () => {
    const check1 = mk([item("12 exercises", true), ai("mainly shoulders", false, "4 of 12 train shoulders")])
    const check2 = mk([item("12 exercises", false, "the day has 11")], JUDGE_SKIPPED)
    const s = setup({ 1: check1, 2: check2 })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(1)
    expect(r.check.items).toEqual(check1.items)
    expect(r.check.rebuilt).toBe(true)
    expect(r.check.note).toBe("The rebuild missed more, so the first attempt was kept.")
  })

  it("keeps attempt 2 on code lines and carries attempt 1's unmet AI lines, marked not re-checked", async () => {
    const check1 = mk([
      item("12 exercises", false, "the day has 11"),
      ai("mainly shoulders", false, "4 of 12 train shoulders"),
      ai("power first", true, "box jump is first"),
    ])
    const check2 = mk([item("12 exercises", true, "12 in the day")], JUDGE_SKIPPED)
    const s = setup({ 1: check1, 2: check2 })
    const r = await runWithComplianceCheck(s.args)
    expect(r.attempt.id).toBe(2)
    expect(r.check.items).toEqual([
      item("12 exercises", true, "12 in the day"),
      ai("mainly shoulders", false, "4 of 12 train shoulders (not re-checked after the rebuild)"),
    ])
    expect(r.check.status).toBe("failed")
    expect(r.check.rebuilt).toBe(true)
    expect(r.check.note).toBe(JUDGE_SKIPPED)
  })

  it("a code tie keeps attempt 2, still carrying the unmet AI lines", async () => {
    const check1 = mk([item("12 exercises", false, "the day has 11"), ai("mainly shoulders", false, "4 of 12")])
    const check2 = mk([item("12 exercises", false, "the day has 10")], JUDGE_SKIPPED)
    const r = await runWithComplianceCheck(setup({ 1: check1, 2: check2 }).args)
    expect(r.attempt.id).toBe(2)
    expect(r.check.items.map((i) => [i.instruction, i.met, i.source])).toEqual([
      ["12 exercises", false, "code"],
      ["mainly shoulders", false, "ai"],
    ])
  })

  it("when attempt 2 WAS judged, every line counts as before (presence control)", async () => {
    const check1 = mk([item("12 exercises", true), ai("mainly shoulders", false)])
    const check2 = mk([item("12 exercises", false), ai("mainly shoulders", true)])
    const r = await runWithComplianceCheck(setup({ 1: check1, 2: check2 }).args)
    expect(r.attempt.id).toBe(2)
    expect(r.check.items).toEqual(check2.items)
  })
})

describe("checkWithinBudget", () => {
  // 11 exercises against "12 exercises": the code check alone decides "failed".
  const input: CheckInput = {
    scope: "day",
    instructions: "12 exercises, mainly shoulder",
    rows: Array.from({ length: 11 }, (_, i) => ({
      day_of_week: 1,
      order: i,
      exercise_id: `e${i}`,
      name: `Ex ${i}`,
      movement_pattern: "push",
      primary_muscles: ["shoulders"],
      role: "accessory",
      sets: 3,
      reps: "8",
      rest_seconds: 60,
      tempo: null,
    })),
    pool: null,
    namedMatches: [],
    bannedIds: [],
    nameById: {},
  }
  const ok = mk([item("12 exercises", true)])
  const deadline = (remaining: number) => ({ signal: new AbortController().signal, remainingMs: () => remaining })

  it("exports a 30s save reserve", () => {
    expect(SAVE_RESERVE_MS).toBe(30_000)
  })

  it("no deadline -> the judge gets its full 30s", async () => {
    const run = vi.fn(async () => ok)
    await checkWithinBudget(input, undefined, { keepOnTimeout: true }, run)
    expect(run).toHaveBeenCalledWith(input, { signal: undefined, timeoutMs: 30_000 })
  })

  it("plenty of time -> 30s cap; less -> what is left after the save reserve", async () => {
    const run = vi.fn(async (_input: CheckInput, _opts?: object) => ok)
    const d1 = deadline(200_000)
    await checkWithinBudget(input, d1, { keepOnTimeout: true }, run)
    expect(run).toHaveBeenLastCalledWith(input, { signal: d1.signal, timeoutMs: 30_000 })
    await checkWithinBudget(input, deadline(50_000), { keepOnTimeout: true }, run)
    expect(run.mock.calls[1][1]).toMatchObject({ timeoutMs: 20_000 })
    await checkWithinBudget(input, deadline(35_000), { keepOnTimeout: true }, run)
    expect(run.mock.calls[2][1]).toMatchObject({ timeoutMs: 5_000 })
  })

  it("under 5s for the judge -> code checks only, no AI call", async () => {
    const run = vi.fn(async () => ok)
    await checkWithinBudget(input, deadline(34_999), { keepOnTimeout: false }, run)
    expect(run).toHaveBeenCalledWith(input, { skipAi: true })
  })

  it("first check runs out of time -> code-only check with a note, not a throw", async () => {
    const run = vi.fn(async () => {
      throw new DeadlineExceededError("Day", "check", 1000)
    })
    const check = await checkWithinBudget(input, deadline(200_000), { keepOnTimeout: true }, run)
    expect(check.items.map((i) => [i.instruction, i.met, i.source])).toEqual([["12 exercises", false, "code"]])
    expect(check.status).toBe("failed")
    expect(check.note).toBe("There wasn't time for the AI check, so only the exact checks are shown.")
  })

  it("a later check that runs out of time rethrows, so the loop keeps attempt 1", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    })
    await expect(checkWithinBudget(input, deadline(200_000), { keepOnTimeout: false }, run)).rejects.toThrow("aborted")
  })

  it("a plain error is not swallowed as a timeout", async () => {
    const run = vi.fn(async () => {
      throw new Error("boom")
    })
    await expect(checkWithinBudget(input, deadline(200_000), { keepOnTimeout: true }, run)).rejects.toThrow("boom")
  })
})
