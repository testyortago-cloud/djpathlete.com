import { describe, it, expect } from "vitest"
import {
  StrategyBriefSchema,
  SpecialistMemoSchema,
} from "@/lib/strategy/specialist-contract"

describe("StrategyBriefSchema", () => {
  it("accepts a minimal valid brief", () => {
    const parsed = StrategyBriefSchema.parse({
      week_of: "2026-05-18",
      themes: [{ tag: "rotational-power", weight: 0.8 }],
      audience_focus: "Golfers 45+ recovering rotational power",
      priority_channel: "seo",
      keywords_to_chase: ["rotational power"],
      hooks_to_test: ["the lost decade"],
      ctas: ["Book a Comeback Code call"],
      dont_do: [],
      rationale: "GSC striking-distance + ads CAC favor rotational content",
    })
    expect(parsed.themes[0].tag).toBe("rotational-power")
  })

  it("rejects an invalid priority_channel", () => {
    expect(() =>
      StrategyBriefSchema.parse({
        week_of: "2026-05-18",
        themes: [],
        audience_focus: "x",
        priority_channel: "email",
        keywords_to_chase: [],
        hooks_to_test: [],
        ctas: [],
        dont_do: [],
        rationale: "x",
      }),
    ).toThrow()
  })
})

describe("SpecialistMemoSchema", () => {
  it("accepts a memo with no brief (ran_without_brief=true)", () => {
    const parsed = SpecialistMemoSchema.parse({
      channel: "seo",
      brief_id: null,
      brief_alignment_score: null,
      ran_without_brief: true,
      signals_summary: "no brief, fell back",
      actions: [],
      rationale: "x",
      outcome_status: "pending",
      outcome_metrics: null,
    })
    expect(parsed.ran_without_brief).toBe(true)
  })

  it("rejects alignment_score out of range", () => {
    expect(() =>
      SpecialistMemoSchema.parse({
        channel: "seo",
        brief_id: "uuid",
        brief_alignment_score: 11,
        ran_without_brief: false,
        signals_summary: "x",
        actions: [],
        rationale: "x",
        outcome_status: "pending",
        outcome_metrics: null,
      }),
    ).toThrow()
  })
})
