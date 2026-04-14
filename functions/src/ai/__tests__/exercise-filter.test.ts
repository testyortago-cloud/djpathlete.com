import { describe, it, expect } from "vitest"
import { applyUsagePenalty } from "../exercise-filter.js"

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
