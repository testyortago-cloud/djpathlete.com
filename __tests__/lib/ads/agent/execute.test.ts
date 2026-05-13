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

import { executeAdsAction } from "@/lib/ads/agent/execute"
import type { AdsAction } from "@/lib/ads/agent/types"

const baseAction = (overrides: Partial<AdsAction> = {}): AdsAction => ({
  rank: 1,
  tool: "propose_new_keywords",
  args: { campaign_id: "c1", ad_group_id: "ag1", keywords: [{ text: "x", match_type: "exact" }] },
  rationale: "test rationale",
  expected_metric: "CVR",
  expected_direction: "increase",
  confidence: "medium",
  supporting_signals: ["organic_wins_not_in_ads"],
  ...overrides,
})

describe("executeAdsAction (within-campaign)", () => {
  beforeEach(() => {
    inserted.length = 0
  })

  it("writes a propose_new_keywords action with recommendation_type='add_keyword'", async () => {
    const out = await executeAdsAction(
      baseAction(),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    expect(out.recommendation_id).toBe("rec-1")

    const row = inserted[0]
    // Real schema columns (00116_google_ads_recommendations.sql)
    expect(row.recommendation_type).toBe("add_keyword")
    expect(row.customer_id).toBe("cust-1")
    expect(row.scope_type).toBe("ad_group")
    expect(row.scope_id).toBe("ag1")
    expect(row.status).toBe("pending")
    expect(row.reasoning).toBe("test rationale")
    expect(row.confidence).toBe(0.5) // medium -> 0.5

    // memo back-reference + source live inside payload (no top-level columns)
    const payload = row.payload as Record<string, unknown>
    expect(payload.memo_id).toBe("memo-1")
    expect(payload.source).toBe("ads_agent")
    expect(payload.tool).toBe("propose_new_keywords")
    expect(payload.args).toEqual({
      campaign_id: "c1",
      ad_group_id: "ag1",
      keywords: [{ text: "x", match_type: "exact" }],
    })
    expect(payload.expected_metric).toBe("CVR")
    expect(payload.expected_direction).toBe("increase")
    expect(payload.confidence).toBe("medium")
    expect(payload.supporting_signals).toEqual(["organic_wins_not_in_ads"])
  })

  it("writes a propose_negative_keywords action with recommendation_type='add_negative_keyword'", async () => {
    await executeAdsAction(
      baseAction({
        tool: "propose_negative_keywords",
        args: {
          campaign_id: "c1",
          negatives: [{ text: "n", match_type: "phrase", scope: "campaign" }],
        },
      }),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    const row = inserted[0]
    expect(row.recommendation_type).toBe("add_negative_keyword")
    expect(row.scope_type).toBe("campaign")
    expect(row.scope_id).toBe("c1")
  })

  it("writes propose_ad_copy_test with recommendation_type='add_ad_variant'", async () => {
    await executeAdsAction(
      baseAction({
        tool: "propose_ad_copy_test",
        args: {
          ad_group_id: "ag1",
          variant: {
            headlines: ["a", "b", "c"],
            descriptions: ["d", "e"],
            final_url: "/x",
          },
        },
      }),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    const row = inserted[0]
    expect(row.recommendation_type).toBe("add_ad_variant")
    expect(row.scope_type).toBe("ad_group")
    expect(row.scope_id).toBe("ag1")
  })

  it("maps confidence string to numeric: low=0.25, medium=0.5, high=0.85", async () => {
    await executeAdsAction(
      baseAction({ confidence: "low" }),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    await executeAdsAction(
      baseAction({ confidence: "medium" }),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    await executeAdsAction(
      baseAction({ confidence: "high" }),
      { memo_id: "memo-1", customer_id: "cust-1" },
    )
    expect(inserted.map((r) => r.confidence)).toEqual([0.25, 0.5, 0.85])
  })

  it("throws for tools that have no slot in the existing recommendation_type CHECK", async () => {
    // The real CHECK constraint only accepts:
    //   add_negative_keyword | adjust_bid | pause_keyword | add_keyword
    //   | add_ad_variant | pause_ad
    // Tools without a target (budget_shift, audience_expansion, new_campaign,
    // campaign_pause, campaign_split, match_type_change, bid_strategy_review,
    // flag_for_human) cannot be written to this table until the schema is
    // extended. Surface a typed error so callers can route them elsewhere.
    await expect(
      executeAdsAction(
        baseAction({
          tool: "propose_budget_shift",
          args: { from_campaign_id: "c1", to_campaign_id: "c1", delta_pct: 10 },
        }),
        { memo_id: "memo-1", customer_id: "cust-1" },
      ),
    ).rejects.toThrow(/no recommendation_type mapping/i)

    await expect(
      executeAdsAction(
        baseAction({
          tool: "propose_audience_expansion",
          args: { campaign_id: "c1", audience_id: "ul1" },
        }),
        { memo_id: "memo-1", customer_id: "cust-1" },
      ),
    ).rejects.toThrow(/no recommendation_type mapping/i)
  })
})
