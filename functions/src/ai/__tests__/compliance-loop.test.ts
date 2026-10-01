import { describe, it, expect, vi } from "vitest"
import { runWithComplianceCheck } from "../compliance-loop.js"
import { buildComplianceFeedback, type InstructionCheck, type InstructionCheckItem } from "../instruction-check.js"
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

  it("rebuild throws DeadlineExceededError -> rethrown", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockImplementation(async (fb) => {
      if (fb) throw new DeadlineExceededError("Day", "rebuild", 1000)
      return { id: 1, durationMs: 1000 }
    })
    await expect(runWithComplianceCheck(s.args)).rejects.toBeInstanceOf(DeadlineExceededError)
  })

  it("rebuild throws AbortError -> rethrown", async () => {
    const s = setup({ 1: failed1 })
    s.build.mockImplementation(async (fb) => {
      if (fb) throw Object.assign(new Error("x"), { name: "AbortError" })
      return { id: 1, durationMs: 1000 }
    })
    await expect(runWithComplianceCheck(s.args)).rejects.toThrow("x")
  })
})
