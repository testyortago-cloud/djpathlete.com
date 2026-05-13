import { describe, it, expect, vi, beforeEach } from "vitest"

const inserted: Array<Record<string, unknown>> = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            inserted.push(row)
            return Promise.resolve({ data: { id: `rec-${inserted.length}` }, error: null })
          },
        }),
      }),
    }),
  }),
}))

import { executeAdsAction, executeAdsActions, type PreExecutionPair } from "@/lib/ads/agent/execute"
import type {
  AdsAction,
  AdsActionTool,
  GuardrailResult,
  GuardrailAnnotations,
} from "@/lib/ads/agent/types"

const makeAction = (overrides: Partial<AdsAction> & { tool: AdsActionTool }): AdsAction => ({
  rank: 1,
  args: {},
  rationale: "test rationale",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: ["organic_wins_not_in_ads"],
  ...overrides,
})

// Table-driven coverage for all 11 ads-agent tools. Each case asserts the
// mapping from tool → (recommendation_type, scope_type, scope_id) and that
// memo_id / source are written to top-level columns (post-migration 00131).
describe("executeAdsAction — full 11-tool catalog", () => {
  beforeEach(() => {
    inserted.length = 0
  })

  const cases: Array<{
    label: string
    action: AdsAction
    expectedType: string
    expectedScopeType: string
    expectedScopeId: string
  }> = [
    {
      label: "propose_new_keywords",
      action: makeAction({
        tool: "propose_new_keywords",
        args: { ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
      }),
      expectedType: "add_keyword",
      expectedScopeType: "ad_group",
      expectedScopeId: "ag1",
    },
    {
      label: "propose_negative_keywords",
      action: makeAction({
        tool: "propose_negative_keywords",
        args: {
          campaign_id: "c1",
          negatives: [{ text: "n", match_type: "phrase", scope: "campaign" }],
        },
      }),
      expectedType: "add_negative_keyword",
      expectedScopeType: "campaign",
      expectedScopeId: "c1",
    },
    {
      label: "propose_ad_copy_test",
      action: makeAction({
        tool: "propose_ad_copy_test",
        args: {
          ad_group_id: "ag1",
          variant: { headlines: ["a", "b", "c"], descriptions: ["d", "e"], final_url: "/x" },
        },
      }),
      expectedType: "add_ad_variant",
      expectedScopeType: "ad_group",
      expectedScopeId: "ag1",
    },
    {
      label: "propose_budget_shift",
      action: makeAction({
        tool: "propose_budget_shift",
        args: { from_campaign_id: "c1", to_campaign_id: "c2", delta_pct: 10 },
      }),
      expectedType: "budget_shift",
      expectedScopeType: "campaign",
      expectedScopeId: "c2", // pins to destination campaign
    },
    {
      label: "propose_audience_expansion",
      action: makeAction({
        tool: "propose_audience_expansion",
        args: { campaign_id: "c1", audience_id: "ul1" },
      }),
      expectedType: "audience_expansion",
      expectedScopeType: "campaign",
      expectedScopeId: "c1",
    },
    {
      label: "propose_new_campaign",
      action: makeAction({
        tool: "propose_new_campaign",
        args: {
          name: "X",
          type: "search",
          initial_daily_budget: 20,
          target_keywords: ["a"],
          landing_page_url: "/y",
          conversion_action_ids: ["ca1"],
        },
      }),
      expectedType: "new_campaign",
      expectedScopeType: "account",
      expectedScopeId: "__new_campaign__",
    },
    {
      label: "propose_campaign_pause",
      action: makeAction({
        tool: "propose_campaign_pause",
        args: { campaign_id: "c1", reason: "spend without conversions" },
      }),
      expectedType: "campaign_pause",
      expectedScopeType: "campaign",
      expectedScopeId: "c1",
    },
    {
      label: "propose_campaign_split",
      action: makeAction({
        tool: "propose_campaign_split",
        args: { campaign_id: "c1", split_dimension: "brand_vs_nonbrand" },
      }),
      expectedType: "campaign_split",
      expectedScopeType: "campaign",
      expectedScopeId: "c1",
    },
    {
      label: "propose_match_type_change",
      action: makeAction({
        tool: "propose_match_type_change",
        args: {
          ad_group_id: "ag1",
          keyword_id: "kw1",
          from_match_type: "broad",
          to_match_type: "phrase",
        },
      }),
      expectedType: "match_type_change",
      expectedScopeType: "keyword",
      expectedScopeId: "kw1",
    },
    {
      label: "propose_bid_strategy_review",
      action: makeAction({
        tool: "propose_bid_strategy_review",
        args: {
          campaign_id: "c1",
          current_strategy: "manual_cpc",
          suggested_strategy: "max_conversions",
          reason: "r",
        },
      }),
      expectedType: "bid_strategy_review",
      expectedScopeType: "campaign",
      expectedScopeId: "c1",
    },
    {
      label: "flag_for_human",
      action: makeAction({ tool: "flag_for_human", args: {} }),
      expectedType: "flag",
      expectedScopeType: "account",
      expectedScopeId: "__account__",
    },
  ]

  for (const c of cases) {
    it(`maps ${c.label} → recommendation_type=${c.expectedType}, scope_type=${c.expectedScopeType}, scope_id=${c.expectedScopeId}`, async () => {
      const out = await executeAdsAction(c.action, { memo_id: "memo-1", customer_id: "cust-1" })
      expect(out.recommendation_id).toBe("rec-1")

      const row = inserted[0]
      expect(row.recommendation_type).toBe(c.expectedType)
      expect(row.scope_type).toBe(c.expectedScopeType)
      expect(row.scope_id).toBe(c.expectedScopeId)

      // Top-level memo_id / source (post-migration 00131)
      expect(row.memo_id).toBe("memo-1")
      expect(row.source).toBe("ads_agent")

      // Common columns
      expect(row.customer_id).toBe("cust-1")
      expect(row.status).toBe("pending")
      expect(row.reasoning).toBe("test rationale")
      expect(row.confidence).toBe(0.5) // medium

      // Payload retains tool args + agent metadata (but no longer carries memo_id/source).
      const payload = row.payload as Record<string, unknown>
      expect(payload.tool).toBe(c.action.tool)
      expect(payload.args).toEqual(c.action.args)
      expect(payload.expected_metric).toBe(c.action.expected_metric)
      expect(payload.expected_direction).toBe(c.action.expected_direction)
      expect(payload.confidence).toBe(c.action.confidence)
      expect(payload.supporting_signals).toEqual(c.action.supporting_signals)
      expect(payload.rank).toBe(c.action.rank)
      // memo_id / source moved out of payload to top-level columns
      expect(payload.memo_id).toBeUndefined()
      expect(payload.source).toBeUndefined()
    })
  }

  it("maps confidence string to numeric: low=0.25, medium=0.5, high=0.85", async () => {
    const base = makeAction({
      tool: "propose_new_keywords",
      args: { ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
    })
    await executeAdsAction({ ...base, confidence: "low" }, { memo_id: "memo-1", customer_id: "cust-1" })
    await executeAdsAction({ ...base, confidence: "medium" }, { memo_id: "memo-1", customer_id: "cust-1" })
    await executeAdsAction({ ...base, confidence: "high" }, { memo_id: "memo-1", customer_id: "cust-1" })
    expect(inserted.map((r) => r.confidence)).toEqual([0.25, 0.5, 0.85])
  })

  it("throws when a required scope_id is missing (propose_new_keywords without ad_group_id)", async () => {
    await expect(
      executeAdsAction(
        makeAction({ tool: "propose_new_keywords", args: {} }),
        { memo_id: "memo-1", customer_id: "cust-1" },
      ),
    ).rejects.toThrow(/ad_group_id/)
  })

  it("throws when a required scope_id is missing (propose_budget_shift without to_campaign_id)", async () => {
    await expect(
      executeAdsAction(
        makeAction({
          tool: "propose_budget_shift",
          args: { from_campaign_id: "c1", delta_pct: 10 },
        }),
        { memo_id: "memo-1", customer_id: "cust-1" },
      ),
    ).rejects.toThrow(/to_campaign_id/)
  })

  it("throws when a required scope_id is missing (propose_match_type_change without keyword_id)", async () => {
    await expect(
      executeAdsAction(
        makeAction({
          tool: "propose_match_type_change",
          args: { ad_group_id: "ag1", from_match_type: "broad", to_match_type: "phrase" },
        }),
        { memo_id: "memo-1", customer_id: "cust-1" },
      ),
    ).rejects.toThrow(/keyword_id/)
  })
})

const makePass = (
  action: AdsAction,
  annotations: Partial<GuardrailAnnotations> = {},
): GuardrailResult => ({
  kind: "pass",
  action,
  annotations: {
    significance: "insufficient_data",
    audit_confidence: "low",
    seasonality_flag: false,
    clamped: false,
    ...annotations,
  },
})

const makeReject = (reason: string): GuardrailResult => ({ kind: "reject", reason })

describe("executeAdsActions (batch)", () => {
  beforeEach(() => {
    inserted.length = 0
  })

  it("persists only passing actions to the recommendations queue", async () => {
    const a1 = makeAction({
      tool: "propose_new_keywords",
      args: { ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
    })
    const a2 = makeAction({
      rank: 2,
      tool: "propose_negative_keywords",
      args: {
        campaign_id: "c1",
        negatives: [{ text: "DJP Athlete reviews", match_type: "phrase", scope: "campaign" }],
      },
    })
    const a3 = makeAction({
      rank: 3,
      tool: "propose_campaign_pause",
      args: { campaign_id: "c1", reason: "underperforming" },
    })
    const pairs: PreExecutionPair[] = [
      { originalAction: a1, guardrail: makePass(a1, { significance: "sig", audit_confidence: "high" }) },
      { originalAction: a2, guardrail: makeReject("Brand allowlist hit.") },
      { originalAction: a3, guardrail: makePass(a3, { significance: "underpowered", audit_confidence: "medium" }) },
    ]
    const out = await executeAdsActions(pairs, { memo_id: "memo-1", customer_id: "cust-1" })
    expect(inserted).toHaveLength(2)
    expect(out.actions).toHaveLength(3)
    expect(out.actions.map((a) => a.status)).toEqual(["queued", "rejected_by_guardrails", "queued"])
    expect(out.rejections).toEqual([
      { rank: 2, tool: "propose_negative_keywords", reason: "Brand allowlist hit." },
    ])
  })

  it("carries guardrail annotations onto queued actions", async () => {
    const a = makeAction({
      tool: "propose_budget_shift",
      args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 50 },
    })
    const pairs: PreExecutionPair[] = [
      { originalAction: a, guardrail: makePass(a, { significance: "sig", audit_confidence: "high", clamped: true }) },
    ]
    const out = await executeAdsActions(pairs, { memo_id: "memo-1", customer_id: "cust-1" })
    expect(out.actions[0].audit_confidence).toBe("high")
    expect(out.actions[0].significance).toBe("sig")
    expect(out.actions[0].clamped).toBe(true)
    expect(out.actions[0].recommendation_id).toBe("rec-1")
  })

  it("marks an action as failed if executeAdsAction throws (e.g. missing scope_id)", async () => {
    const bad = makeAction({ tool: "propose_new_keywords", args: {} }) // missing ad_group_id
    const pairs: PreExecutionPair[] = [
      { originalAction: bad, guardrail: makePass(bad) },
    ]
    const out = await executeAdsActions(pairs, { memo_id: "memo-1", customer_id: "cust-1" })
    expect(out.actions).toHaveLength(1)
    expect(out.actions[0].status).toBe("failed")
    expect(out.actions[0].recommendation_id).toBeNull()
    expect(out.rejections).toHaveLength(0) // guardrail-rejections only; throws are not rejections
  })

  it("processes each pair independently — a thrown action does not block others", async () => {
    const bad = makeAction({ rank: 1, tool: "propose_new_keywords", args: {} })
    const good = makeAction({
      rank: 2,
      tool: "propose_negative_keywords",
      args: { campaign_id: "c1", negatives: [{ text: "x", match_type: "phrase", scope: "campaign" }] },
    })
    const pairs: PreExecutionPair[] = [
      { originalAction: bad, guardrail: makePass(bad) },
      { originalAction: good, guardrail: makePass(good) },
    ]
    const out = await executeAdsActions(pairs, { memo_id: "memo-1", customer_id: "cust-1" })
    expect(out.actions.map((a) => a.status)).toEqual(["failed", "queued"])
    expect(inserted).toHaveLength(1) // only the good one reached the table
  })
})
