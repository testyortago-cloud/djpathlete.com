import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCallAgent = vi.hoisted(() => vi.fn())

vi.mock("../../ai/anthropic.js", () => ({
  callAgent: mockCallAgent,
  MODEL_SONNET: "claude-sonnet-test",
}))

import { proposePrimaryKeyword, fallbackKeywordFromTitle } from "../keyword-proposal.js"

describe("keyword-proposal", () => {
  describe("fallbackKeywordFromTitle", () => {
    it("trims and lowercases the title to a 2-6 word phrase", () => {
      expect(fallbackKeywordFromTitle("How to Improve Pitching Velocity for Youth Athletes")).toBe(
        "improve pitching velocity for youth athletes",
      )
    })

    it("strips punctuation and clamps to 6 words", () => {
      expect(fallbackKeywordFromTitle("The Coach's Guide to Comeback, Recovery, and Sleep!")).toBe(
        "coachs guide to comeback recovery and",
      )
    })

    it("removes common stopword prefixes", () => {
      expect(fallbackKeywordFromTitle("The Best Way to Throw a Slider")).toBe(
        "best way to throw a slider",
      )
      expect(fallbackKeywordFromTitle("How to Build Rotational Power")).toBe(
        "build rotational power",
      )
    })

    it("returns the input lowercased when too short for stopword stripping", () => {
      expect(fallbackKeywordFromTitle("Sprint mechanics")).toBe("sprint mechanics")
    })

    it("returns empty string for empty input", () => {
      expect(fallbackKeywordFromTitle("")).toBe("")
    })
  })

  describe("proposePrimaryKeyword", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("returns the Claude-proposed keyword on success", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "youth pitching velocity training" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({
        title: "How young pitchers can throw harder safely",
        summary: "Recent research on long-toss programs and velocity gains.",
      })
      expect(result).toBe("youth pitching velocity training")
      expect(mockCallAgent).toHaveBeenCalledTimes(1)
    })

    it("falls back to title-derived keyword when Claude throws", async () => {
      mockCallAgent.mockRejectedValue(new Error("rate limit"))
      const result = await proposePrimaryKeyword({
        title: "How to Build Rotational Power",
      })
      expect(result).toBe("build rotational power")
      expect(mockCallAgent).toHaveBeenCalledTimes(1)
    })

    it("falls back when Claude returns empty string", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({
        title: "Sprint mechanics for soccer",
      })
      expect(result).toBe("sprint mechanics for soccer")
    })

    it("returns empty string when title is empty and Claude returns nothing", async () => {
      mockCallAgent.mockResolvedValue({
        content: { primary_keyword: "" },
        tokens_used: 50,
      })
      const result = await proposePrimaryKeyword({ title: "" })
      expect(result).toBe("")
    })
  })
})
