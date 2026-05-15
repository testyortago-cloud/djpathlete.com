import { describe, expect, it } from "vitest"
import { scoreClientRisk, type RiskInput } from "@/lib/automation/client-risk-scorer"

const recentIso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86400000).toISOString()

const baseInput: RiskInput = {
  days_since_last_session: 0,
  session_frequency_pct_14d: 100,
  open_form_review_days: null,
  open_performance_assessment_days: null,
  program_ending_in_days: null,
  last_renewal_conversation_at: recentIso(2),
}

describe("scoreClientRisk", () => {
  it("returns tier=none for a fully engaged client", () => {
    const r = scoreClientRisk(baseInput)
    expect(r.risk_score).toBe(0)
    expect(r.risk_tier).toBe("none")
    expect(r.reasons).toEqual([])
  })

  it("inactivity buckets do not stack — only the highest applies", () => {
    expect(scoreClientRisk({ ...baseInput, days_since_last_session: 7 }).risk_score).toBe(15)
    expect(scoreClientRisk({ ...baseInput, days_since_last_session: 14 }).risk_score).toBe(25)
    expect(scoreClientRisk({ ...baseInput, days_since_last_session: 30 }).risk_score).toBe(40)
    expect(scoreClientRisk({ ...baseInput, days_since_last_session: 60 }).risk_score).toBe(40)
  })

  it("session-frequency buckets do not stack — only the highest applies", () => {
    expect(scoreClientRisk({ ...baseInput, session_frequency_pct_14d: 49 }).risk_score).toBe(20)
    expect(scoreClientRisk({ ...baseInput, session_frequency_pct_14d: 24 }).risk_score).toBe(35)
    expect(scoreClientRisk({ ...baseInput, session_frequency_pct_14d: 0 }).risk_score).toBe(35)
  })

  it("null session_frequency_pct_14d contributes nothing", () => {
    const r = scoreClientRisk({ ...baseInput, session_frequency_pct_14d: null })
    expect(r.risk_score).toBe(0)
    expect(r.reasons).toEqual([])
  })

  it("composite high-risk client: inactive 30d + freq 22% + open review 12d", () => {
    const r = scoreClientRisk({
      ...baseInput,
      days_since_last_session: 35,
      session_frequency_pct_14d: 22,
      open_form_review_days: 12,
    })
    expect(r.risk_score).toBe(95) // 40 + 35 + 20
    expect(r.risk_tier).toBe("high")
    expect(r.reasons).toContain("no_session_30d")
    expect(r.reasons).toContain("frequency_lt_25")
    expect(r.reasons).toContain("form_review_stale_10d")
  })

  it("open form review thresholds: 5d -> +10, 10d -> +20 (mutually exclusive)", () => {
    expect(scoreClientRisk({ ...baseInput, open_form_review_days: 5 }).risk_score).toBe(10)
    expect(scoreClientRisk({ ...baseInput, open_form_review_days: 10 }).risk_score).toBe(20)
    expect(scoreClientRisk({ ...baseInput, open_form_review_days: 11 }).reasons).toContain(
      "form_review_stale_10d",
    )
  })

  it("performance assessment open >= 10d adds +10", () => {
    const r = scoreClientRisk({
      ...baseInput,
      open_performance_assessment_days: 10,
    })
    expect(r.risk_score).toBe(10)
    expect(r.reasons).toContain("perf_assessment_stale_10d")
    expect(
      scoreClientRisk({ ...baseInput, open_performance_assessment_days: 9 }).risk_score,
    ).toBe(0)
  })

  it("program-ending: fires only when both end window AND stale renewal hold", () => {
    const recent = scoreClientRisk({
      ...baseInput,
      program_ending_in_days: 10,
      last_renewal_conversation_at: recentIso(5),
    })
    expect(recent.reasons).not.toContain("renewal_unstarted")
    expect(recent.risk_score).toBe(0)

    const noConv = scoreClientRisk({
      ...baseInput,
      program_ending_in_days: 10,
      last_renewal_conversation_at: null,
    })
    expect(noConv.risk_score).toBe(15)
    expect(noConv.reasons).toContain("renewal_unstarted")

    const staleConv = scoreClientRisk({
      ...baseInput,
      program_ending_in_days: 7,
      last_renewal_conversation_at: recentIso(45),
    })
    expect(staleConv.risk_score).toBe(15)
    expect(staleConv.reasons).toContain("renewal_unstarted")

    const outOfWindow = scoreClientRisk({
      ...baseInput,
      program_ending_in_days: 30,
      last_renewal_conversation_at: null,
    })
    expect(outOfWindow.risk_score).toBe(0)
  })

  it("tier mapping respects 60/35/15 cutoffs", () => {
    // exactly 15 = low
    expect(scoreClientRisk({ ...baseInput, days_since_last_session: 7 }).risk_tier).toBe("low")
    // exactly 35 = medium
    expect(
      scoreClientRisk({ ...baseInput, session_frequency_pct_14d: 20 }).risk_tier,
    ).toBe("medium")
    // exactly 60 = high
    expect(
      scoreClientRisk({
        ...baseInput,
        days_since_last_session: 14,
        session_frequency_pct_14d: 20,
      }).risk_tier,
    ).toBe("high")
    // none below 15
    expect(scoreClientRisk(baseInput).risk_tier).toBe("none")
  })

  it("final score is capped at 100", () => {
    const r = scoreClientRisk({
      days_since_last_session: 60,
      session_frequency_pct_14d: 0,
      open_form_review_days: 30,
      open_performance_assessment_days: 30,
      program_ending_in_days: 1,
      last_renewal_conversation_at: null,
    })
    expect(r.risk_score).toBeLessThanOrEqual(100)
    expect(r.risk_score).toBe(100)
    expect(r.risk_tier).toBe("high")
  })
})
