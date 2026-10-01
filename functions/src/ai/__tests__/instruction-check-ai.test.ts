import { describe, it, expect, vi, beforeEach } from "vitest"
const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", async () => {
  const actual = await vi.importActual<typeof import("../anthropic.js")>("../anthropic.js")
  return { ...actual, callAgent: callAgentMock }
})
import { MODEL_OPUS_5_5 } from "../anthropic.js"
import { checkInstructions, type CheckInput } from "../instruction-check.js"

const input = (o: Partial<CheckInput> = {}): CheckInput => ({
  scope: "day",
  instructions: "12 exercises, mainly shoulder",
  rows: Array.from({ length: 12 }, (_, i) => ({
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
  ...o,
})

// Block body on purpose: a function RETURNED from beforeEach runs as teardown,
// and mockReset() returns the mock — the arrow form called it with no arguments.
beforeEach(() => {
  callAgentMock.mockReset()
})

describe("checkInstructions", () => {
  it("adds the AI's lines after the code lines and drops ones code already decided", async () => {
    callAgentMock.mockResolvedValue({
      content: {
        items: [
          { instruction: "12 exercises", met: false, detail: "dup" },
          { instruction: "mainly shoulder", met: true, detail: "12 of 12 train the shoulders" },
        ],
      },
      tokens_used: 10,
    })
    const check = await checkInstructions(input())
    expect(check.items.map((i) => [i.instruction, i.source])).toEqual([
      ["12 exercises", "code"],
      ["mainly shoulder", "ai"],
    ])
    expect(check.status).toBe("passed")
    expect(check.rebuilt).toBe(false)
    expect(check.rebuild_reason).toBeNull()
    const [system, message, , opts] = callAgentMock.mock.calls[0]
    expect(system).toMatch(/Skip any instruction listed under "Already checked by code"/)
    expect(message).toContain("12 exercises, mainly shoulder")
    expect(message).toContain("- 12 exercises: met (12 in the day)")
    expect(message).toContain("Day 1 #1 Ex 0 | push | shoulders | accessory | 3x8 | rest 60s")
    expect(opts).toMatchObject({ model: MODEL_OPUS_5_5, allowHaikuFallback: false })
  })

  it("makes no model call without instructions", async () => {
    const check = await checkInstructions(input({ instructions: null }))
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(check.status).toBe("unchecked")
  })

  it("keeps the code lines and says so when the AI fails", async () => {
    callAgentMock.mockRejectedValue(new Error("boom"))
    const check = await checkInstructions(input())
    expect(check.items.map((i) => i.source)).toEqual(["code"])
    expect(check.note).toBe("The AI check didn't run this time, so only the exact checks are shown.")
  })

  it("says the AI check took too long on its own timeout", async () => {
    callAgentMock.mockImplementation(
      (_s: string, _m: string, _z: unknown, o: { signal: AbortSignal }) =>
        new Promise((_res, rej) =>
          o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        ),
    )
    const check = await checkInstructions(input(), { timeoutMs: 10 })
    expect(check.note).toBe("The AI check took too long, so only the exact checks are shown.")
    expect(check.items.map((i) => i.source)).toEqual(["code"])
  })

  it("rethrows when the generation's own deadline aborts", async () => {
    const outer = new AbortController()
    callAgentMock.mockImplementation(async () => {
      outer.abort()
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    })
    await expect(checkInstructions(input(), { signal: outer.signal })).rejects.toThrow()
  })

  it("skipAi: code checks only, no model call, and says why", async () => {
    const check = await checkInstructions(input({ rows: input().rows.slice(0, 11) }), { skipAi: true })
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(check.items.map((i) => [i.instruction, i.met, i.source])).toEqual([["12 exercises", false, "code"]])
    expect(check.status).toBe("failed")
    expect(check.note).toBe("There wasn't time for the AI check, so only the exact checks are shown.")
  })

  it("skipAi never throws on an already-aborted deadline — the day must still save", async () => {
    const outer = new AbortController()
    outer.abort()
    const check = await checkInstructions(input(), { skipAi: true, signal: outer.signal })
    expect(check.status).toBe("passed")
  })

  it("skipAi with no instructions has nothing to explain", async () => {
    const check = await checkInstructions(input({ instructions: null }), { skipAi: true })
    expect(check.note).toBeNull()
  })

  it("survives an AI reply with no usable items", async () => {
    callAgentMock.mockResolvedValue({
      content: { items: [{ instruction: " ", met: true, detail: "" }] },
      tokens_used: 1,
    })
    const check = await checkInstructions(input())
    expect(check.items).toHaveLength(1)
  })
})
