import { describe, it, expect } from "vitest"
import {
  modelRejectsForcedToolChoice,
  stripUnsupportedSchemaKeywords,
  MODEL_FABLE,
  MODEL_SONNET,
  MODEL_SONNET_5,
  MODEL_OPUS,
  MODEL_HAIKU,
  MODEL_OPUS_5_5,
} from "../ai/anthropic.js"

describe("modelRejectsForcedToolChoice", () => {
  it("is true for Fable, which 400s on tool_choice type 'tool'", () => {
    expect(modelRejectsForcedToolChoice(MODEL_FABLE)).toBe(true)
  })

  it("is false for every model callAgent's tool path is tuned against", () => {
    for (const m of [MODEL_SONNET, MODEL_SONNET_5, MODEL_OPUS, MODEL_HAIKU, "claude-opus-5"]) {
      expect(modelRejectsForcedToolChoice(m), m).toBe(false)
    }
  })

  it("matches the family, not an exact id, so a future point release is handled", () => {
    // A new Fable revision must not silently fall back to the forced-tool path
    // and 400 in production looking like an outage.
    expect(modelRejectsForcedToolChoice("claude-fable-5-2")).toBe(true)
    expect(modelRejectsForcedToolChoice("claude-fable-6")).toBe(true)
    expect(modelRejectsForcedToolChoice("claude-mythos-5-1")).toBe(true)
  })

  it("is true for Opus 5.5, which 400s on forced tool choice through OpenRouter", () => {
    // Measured 2026-09-30: callAgent → 400 "Provider returned error", the same
    // response Fable gives. Opus 5 (no point release) still takes the tool path.
    expect(modelRejectsForcedToolChoice(MODEL_OPUS_5_5)).toBe(true)
    expect(modelRejectsForcedToolChoice("claude-opus-5-6")).toBe(true)
    expect(modelRejectsForcedToolChoice("claude-opus-5")).toBe(false)
    // A dated Opus 5 snapshot id is Opus 5, not a point release.
    expect(modelRejectsForcedToolChoice("claude-opus-5-20260301")).toBe(false)
  })

  it("is true for Sonnet 5.5, which 400s the same way", () => {
    // Measured 2026-10-02 (architect call, "Structured output via tool_use" →
    // 400 "Provider returned error"). Sonnet 5 itself still takes the tool path.
    expect(modelRejectsForcedToolChoice("claude-sonnet-5-5")).toBe(true)
    expect(modelRejectsForcedToolChoice("claude-sonnet-5")).toBe(false)
    expect(modelRejectsForcedToolChoice("claude-sonnet-5-20260301")).toBe(false)
  })

  it("does not match a model that merely contains the word", () => {
    expect(modelRejectsForcedToolChoice("claude-sonnet-fable-test")).toBe(false)
  })
})

describe("stripUnsupportedSchemaKeywords", () => {
  it("removes the array bounds the structured-outputs validator rejects", () => {
    const out = stripUnsupportedSchemaKeywords({
      type: "object",
      properties: { tags: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } } },
    }) as Record<string, unknown>
    const tags = (out.properties as Record<string, Record<string, unknown>>).tags
    expect(tags).not.toHaveProperty("minItems")
    expect(tags).not.toHaveProperty("maxItems")
    expect(tags.type).toBe("array")
    expect(tags.items).toEqual({ type: "string" })
  })

  it("KEEPS string length bounds — stripping them cost 138s of retries", () => {
    // Regression guard for a real failure on 2026-09-12: with maxLength gone
    // the model could not see the 280-character excerpt cap, produced 400
    // characters, was rejected by Zod, and repeated the identical mistake on
    // all five attempts. A constraint the model cannot see is a trap, not a
    // constraint. Only keywords the API actually rejects may be stripped.
    const out = stripUnsupportedSchemaKeywords({
      type: "object",
      properties: { excerpt: { type: "string", minLength: 80, maxLength: 280 } },
    }) as Record<string, unknown>
    const excerpt = (out.properties as Record<string, Record<string, unknown>>).excerpt
    expect(excerpt.minLength).toBe(80)
    expect(excerpt.maxLength).toBe(280)
  })

  it("recurses through nested objects and arrays", () => {
    const out = stripUnsupportedSchemaKeywords({
      type: "object",
      properties: {
        faq: {
          type: "array",
          maxItems: 5,
          items: { type: "object", properties: { tags: { type: "array", minItems: 3 } } },
        },
      },
    }) as Record<string, unknown>
    const faq = (out.properties as Record<string, Record<string, unknown>>).faq
    expect(faq).not.toHaveProperty("maxItems")
    const inner = (faq.items as Record<string, Record<string, Record<string, unknown>>>).properties.tags
    expect(inner).not.toHaveProperty("minItems")
  })

  it("leaves a schema with nothing to strip byte-identical", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] }
    expect(stripUnsupportedSchemaKeywords(schema)).toEqual(schema)
  })

  it("survives null and primitives without throwing", () => {
    expect(stripUnsupportedSchemaKeywords(null)).toBeNull()
    expect(stripUnsupportedSchemaKeywords("x")).toBe("x")
    expect(stripUnsupportedSchemaKeywords(5)).toBe(5)
  })
})

// 2026-10-02: five real coach requests replayed on the dev clone. GPT-6.1 Sol
// missed 7 instructions to Astra's 6 at $1.27 against $5.52, and was the fastest
// (slowest run 214s against 327s, under the 450s week budget).
describe("the planning agents' default model", () => {
  it("is GPT-6.1 Sol for both the architect and the selector when nothing overrides it", async () => {
    expect(process.env.PROGRAM_ARCHITECT_MODEL).toBeUndefined()
    expect(process.env.EXERCISE_SELECTOR_MODEL).toBeUndefined()
    const { MODEL_PROGRAM_ARCHITECT, MODEL_EXERCISE_SELECTOR } = await import("../ai/anthropic.js")
    expect(MODEL_PROGRAM_ARCHITECT).toBe("gpt-6-1-sol")
    expect(MODEL_EXERCISE_SELECTOR).toBe("gpt-6-1-sol")
  })
})
