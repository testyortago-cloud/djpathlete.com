// Restriction extraction: turning "hotel, no equipment, bodyweight focused"
// into an equipment set that the filter can actually enforce.
//
// See instruction-intent.test.ts for why there is no mockReset() here.
import { describe, it, expect, vi } from "vitest"

const callAgentMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_HAIKU: "claude-haiku-4-5-20251001",
}))

import { extractInstructionIntent, fallbackIntent, hasRestrictionCue, EMPTY_INTENT } from "../instruction-intent.js"

describe("hasRestrictionCue — the deterministic guard over the model", () => {
  it.each([
    "client is travelling, hotel no equipment week",
    "body weight focused",
    "bodyweight only this week",
    "no equipment available",
    "bands only",
    "she is on the road with no gym",
    "equipment-free week please",
    "without equipment",
  ])("recognises a restriction in %j", (text) => {
    expect(hasRestrictionCue(text)).toBe(true)
  })

  it.each([
    "3 squat pattern, 3 hinge, 3 upper push",
    "make this a deload week",
    "use cluster sets on the compounds",
    "start with plyometrics, finish with core",
    "add more glute work",
  ])("does NOT fire on ordinary programming in %j", (text) => {
    expect(hasRestrictionCue(text)).toBe(false)
  })
})

describe("extractInstructionIntent — only_equipment", () => {
  it("carries a model-reported bodyweight-only restriction through", async () => {
    callAgentMock.mockResolvedValueOnce({
      content: { ...EMPTY_INTENT, only_equipment: [] },
      tokens_used: 1,
    })
    const intent = await extractInstructionIntent("Hotel week, no equipment, body weight focused")
    expect(intent.only_equipment).toEqual([])
  })

  it("normalizes the restricted list to canonical equipment names", async () => {
    callAgentMock.mockResolvedValueOnce({
      content: { ...EMPTY_INTENT, only_equipment: ["bands", "dumbbells"] },
      tokens_used: 1,
    })
    const intent = await extractInstructionIntent("Bands and dumbbells only this week")
    expect(intent.only_equipment).toEqual(["resistance_band", "dumbbell"])
  })

  it("REFUSES a restriction the text does not support, however sure the model is", async () => {
    // The blast radius of a false positive is an entire week reduced to
    // bodyweight, so the model does not get the last word here.
    callAgentMock.mockResolvedValueOnce({
      content: { ...EMPTY_INTENT, only_equipment: [] },
      tokens_used: 1,
    })
    const intent = await extractInstructionIntent("Use cluster sets on the compounds")
    expect(intent.only_equipment).toBeNull()
  })

  it("leaves only_equipment null when the model reports no restriction", async () => {
    callAgentMock.mockResolvedValueOnce({ content: { ...EMPTY_INTENT }, tokens_used: 1 })
    const intent = await extractInstructionIntent("Hotel week with no equipment")
    expect(intent.only_equipment).toBeNull()
  })

  it("degrades to no restriction when the model call fails", async () => {
    callAgentMock.mockRejectedValueOnce(new Error("503"))
    const intent = await extractInstructionIntent("Hotel week, no equipment at all")
    expect(intent.only_equipment).toBeNull()
  })

  it("returns EMPTY_INTENT (no restriction) for empty instructions", async () => {
    const intent = await extractInstructionIntent("")
    expect(intent.only_equipment).toBeNull()
  })
})

describe("fallbackIntent never invents a restriction", () => {
  it("returns null only_equipment even for restriction-shaped text", () => {
    // The fallback runs when the model is unreachable. Guessing that a week
    // should be bodyweight-only, with no model to read polarity, is worse than
    // generating the same week the coach got last month.
    expect(fallbackIntent("hotel, no equipment, bodyweight only").only_equipment).toBeNull()
    expect(fallbackIntent("use dumbbells and a bench").only_equipment).toBeNull()
  })
})
