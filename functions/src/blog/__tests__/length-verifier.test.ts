import { describe, it, expect } from "vitest"
import {
  countWords,
  LENGTH_PRESETS,
  isTooShort,
  buildExpansionPrompt,
  resolveTargetWordCount,
} from "../length-verifier.js"

describe("length-verifier", () => {
  describe("countWords", () => {
    it("counts words in plain HTML", () => {
      expect(countWords("<p>One two three four five</p>")).toBe(5)
    })

    it("strips tags before counting", () => {
      expect(countWords("<h2>Heading</h2><p>One <strong>two</strong> three</p>")).toBe(4)
    })

    it("handles multiple whitespace and newlines", () => {
      expect(countWords("<p>One\n\n  two\tthree</p>")).toBe(3)
    })

    it("returns 0 for empty input", () => {
      expect(countWords("")).toBe(0)
      expect(countWords("<p></p>")).toBe(0)
    })

    it("ignores HTML attributes", () => {
      expect(countWords('<a href="https://x.com">link text</a>')).toBe(2)
    })
  })

  describe("LENGTH_PRESETS", () => {
    it("maps short/medium/long to canonical word counts", () => {
      expect(LENGTH_PRESETS.short).toBe(500)
      expect(LENGTH_PRESETS.medium).toBe(1000)
      expect(LENGTH_PRESETS.long).toBe(1500)
    })
  })

  describe("resolveTargetWordCount", () => {
    it("returns explicit target when provided", () => {
      expect(resolveTargetWordCount({ target_word_count: 1200 })).toBe(1200)
    })

    it("falls back to length preset", () => {
      expect(resolveTargetWordCount({ length: "long" })).toBe(1500)
    })

    it("defaults to medium when neither is provided", () => {
      expect(resolveTargetWordCount({})).toBe(1000)
    })

    it("explicit target_word_count wins over length", () => {
      expect(resolveTargetWordCount({ length: "short", target_word_count: 1800 })).toBe(1800)
    })
  })

  describe("isTooShort", () => {
    it("returns true when actual is more than 25% under target", () => {
      expect(isTooShort(700, 1000)).toBe(true)
    })

    it("returns false when actual is within 25% of target", () => {
      expect(isTooShort(800, 1000)).toBe(false)
      expect(isTooShort(900, 1000)).toBe(false)
      expect(isTooShort(1100, 1000)).toBe(false)
    })

    it("returns false when actual exceeds target", () => {
      expect(isTooShort(2000, 1500)).toBe(false)
    })
  })

  describe("buildExpansionPrompt", () => {
    it("includes the actual and target word counts", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>short draft</p>",
        actualWordCount: 600,
        targetWordCount: 1500,
        h2List: ["Why this matters", "How to apply it"],
      })
      expect(out).toContain("600")
      expect(out).toContain("1500")
    })

    it("lists the section headings to expand", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>x</p>",
        actualWordCount: 500,
        targetWordCount: 1000,
        h2List: ["Recovery basics", "When to deload"],
      })
      expect(out).toContain("Recovery basics")
      expect(out).toContain("When to deload")
    })

    it("instructs to keep title/slug/category unchanged", () => {
      const out = buildExpansionPrompt({
        currentHtml: "<p>x</p>",
        actualWordCount: 500,
        targetWordCount: 1000,
        h2List: [],
      })
      expect(out.toLowerCase()).toContain("do not change")
    })
  })
})
