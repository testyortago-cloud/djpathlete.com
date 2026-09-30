import { describe, it, expect, vi, beforeEach } from "vitest"

const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", async () => {
  const actual = await vi.importActual<typeof import("../anthropic.js")>("../anthropic.js")
  return { ...actual, callAgent: callAgentMock }
})

import { enrichCoachInstructions, findDroppedNumbers } from "../instruction-enrich.js"
import { MODEL_OPUS_5_5 } from "../anthropic.js"

// Darren's real Monday instructions, 2026-09-30 (prod job NRs4qIAOUehX5eA4lGzp).
const DARREN =
  "12 exercises \n2-4 sets\n4-8 reps\n30-90sec rest\n4-2-4 tempo\nFocus on shoulder exercises, and some back and chest but mainly shoulder "

const GOOD_REWRITE =
  "Exactly 12 exercises: 7 shoulder, 3 upper-back pulling, 2 chest pressing.\n" +
  "Every exercise: 2-4 sets of 4-8 reps, 30-90 sec rest, 4-2-4 tempo."

const CTX = { scope: "day" as const, targetLabel: "Monday, Week 2", splitType: "upper_lower" }

const answers = (text: string) =>
  callAgentMock.mockResolvedValue({ content: { enriched_instructions: text }, tokens_used: 400 })

describe("enrichCoachInstructions", () => {
  // Block body on purpose: a function RETURNED from beforeEach is run by Vitest
  // as teardown, and mockReset() returns the mock — so the arrow form called
  // the fake after every test with no arguments.
  beforeEach(() => {
    callAgentMock.mockReset()
  })

  it("does nothing, and spends nothing, when the coach wrote nothing", async () => {
    expect(await enrichCoachInstructions(undefined, CTX)).toBeNull()
    expect(await enrichCoachInstructions("   \n ", CTX)).toBeNull()
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("returns the rewrite, and asks Opus 5.5 with no Haiku substitute", async () => {
    answers(GOOD_REWRITE)
    const used = await enrichCoachInstructions(DARREN, CTX)

    expect(used).toEqual({ original: DARREN, enriched: GOOD_REWRITE, model: MODEL_OPUS_5_5, note: null })
    const opts = callAgentMock.mock.calls[0][3]
    expect(opts).toMatchObject({ model: MODEL_OPUS_5_5, allowHaikuFallback: false })
    // The coach's text and where it is going both reach the model.
    expect(callAgentMock.mock.calls[0][1]).toContain("mainly shoulder")
    expect(callAgentMock.mock.calls[0][1]).toContain("Monday, Week 2")
  })

  it("falls back to the coach's own words when the model fails, and says so", async () => {
    callAgentMock.mockImplementation(async () => {
      throw new Error("503 Service Unavailable")
    })
    const used = await enrichCoachInstructions(DARREN, CTX)

    expect(used?.enriched).toBeNull()
    expect(used?.original).toBe(DARREN)
    expect(used?.note).toMatch(/used exactly as written/i)
  })

  it("rejects a rewrite that dropped a number the coach wrote", async () => {
    // "4-2-4" tempo gone — the rewrite would quietly change the prescription.
    answers("Exactly 12 exercises: 7 shoulder, 3 back, 2 chest. 2-4 sets of 4-8 reps, 30-90 sec rest.")
    const used = await enrichCoachInstructions(DARREN, CTX)

    expect(used?.enriched).toBeNull()
    expect(used?.note).toContain("4-2-4")
  })

  it("rejects an empty rewrite", async () => {
    answers("   ")
    const used = await enrichCoachInstructions(DARREN, CTX)
    expect(used?.enriched).toBeNull()
    expect(used?.note).toBeTruthy()
  })

  it("gives up after its own time limit and carries on with the original", async () => {
    callAgentMock.mockImplementation(
      (_s: string, _u: string, _z: unknown, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          )
        }),
    )
    const used = await enrichCoachInstructions(DARREN, CTX, { timeoutMs: 30 })

    expect(used?.enriched).toBeNull()
    expect(used?.note).toMatch(/took too long/i)
  })

  it("rethrows when the WHOLE generation is out of time — that is not enrichment's call", async () => {
    const generation = new AbortController()
    callAgentMock.mockImplementation(async () => {
      generation.abort()
      throw Object.assign(new Error("aborted"), { name: "AbortError" })
    })
    await expect(enrichCoachInstructions(DARREN, CTX, { signal: generation.signal })).rejects.toThrow()
  })
})

describe("findDroppedNumbers", () => {
  it("finds nothing missing when every number survives, whatever the dash", () => {
    expect(findDroppedNumbers(DARREN, GOOD_REWRITE)).toEqual([])
    expect(findDroppedNumbers("30-90sec rest", "30–90 s rest")).toEqual([])
  })

  it("names each number or range that is gone", () => {
    expect(findDroppedNumbers(DARREN, "12 exercises, 2-4 sets")).toEqual(["4-8", "30-90", "4-2-4"])
  })

  it("does not count a range as present because its parts appear separately", () => {
    // "4-8" must survive as a range, not as a stray 4 and a stray 8.
    expect(findDroppedNumbers("4-8 reps", "4 sets of 8 reps")).toEqual(["4-8"])
  })
})
