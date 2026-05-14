import { describe, it, expect } from "vitest"
import { adsAgentDecisionSchema } from "@/lib/ads/agent/decision-schema"

const validAction = {
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "Adding two organic-winning queries currently absent from the campaign.",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: ["organic_wins_not_in_ads"],
}

describe("adsAgentDecisionSchema", () => {
  it("accepts a valid decision with one action", () => {
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "Snapshot read here.",
      actions: [validAction],
      watch_list: ["Watch CAC on Brand Search next week."],
      brief_alignment_score: null,
    }).success).toBe(true)
  })

  it("rejects unknown tool name", () => {
    const bad = { ...validAction, tool: "delete_everything" }
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x", actions: [bad], watch_list: [], brief_alignment_score: null,
    }).success).toBe(false)
  })

  it("rejects > 7 actions", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...validAction, rank: i + 1 }))
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x", actions: many, watch_list: [], brief_alignment_score: null,
    }).success).toBe(false)
  })

  it("rejects > 5 watch_list items", () => {
    expect(adsAgentDecisionSchema.safeParse({
      rationale: "x",
      actions: [validAction],
      watch_list: ["a", "b", "c", "d", "e", "f"],
      brief_alignment_score: null,
    }).success).toBe(false)
  })

  it("accepts every supported tool", () => {
    const tools = [
      "propose_budget_shift", "propose_new_keywords", "propose_negative_keywords",
      "propose_ad_copy_test", "propose_audience_expansion",
      "propose_new_campaign", "propose_campaign_pause", "propose_campaign_split",
      "propose_match_type_change", "propose_bid_strategy_review", "flag_for_human",
    ]
    for (const tool of tools) {
      const result = adsAgentDecisionSchema.safeParse({
        rationale: "x", watch_list: [],
        actions: [{ ...validAction, tool }],
        brief_alignment_score: null,
      })
      expect(result.success, `tool "${tool}" should parse`).toBe(true)
    }
  })

  it("accepts brief_alignment_score in [1,10] and null", () => {
    for (const score of [1, 5, 10, null]) {
      const result = adsAgentDecisionSchema.safeParse({
        rationale: "x", actions: [validAction], watch_list: [],
        brief_alignment_score: score,
      })
      expect(result.success, `score ${score} should parse`).toBe(true)
    }
  })

  it("rejects brief_alignment_score outside 1-10 range", () => {
    for (const score of [0, 11, -1, 1.5]) {
      const result = adsAgentDecisionSchema.safeParse({
        rationale: "x", actions: [validAction], watch_list: [],
        brief_alignment_score: score,
      })
      expect(result.success, `score ${score} should NOT parse`).toBe(false)
    }
  })
})
