// buildMutation coverage for add_negative_keyword — the branch where three
// bugs stacked up because nothing ever exercised it (all 11 prior applies were
// new_campaign, which needs no scope).
//
// Bug 3, caught only in production by the coach clicking Approve:
//   googleAds:mutate 400 DUPLICATE_TEMP_IDS — "Creating more than one resource
//   with the same temp ID is not allowed", trigger int64Value "-1".
// Fanning one rec out to 26 creates while keeping the single-op path's
// hardcoded "-1" temp id meant every op asked Google for the same temp id.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ getCampaignById: vi.fn() }))

vi.mock("@/lib/db/google-ads-campaigns", () => ({
  getCampaignById: mocks.getCampaignById,
  upsertCampaign: vi.fn(),
}))
vi.mock("@/lib/db/google-ads-recommendations", () => ({
  getRecommendationById: vi.fn(),
  updateRecommendationStatus: vi.fn(),
  listPendingRecommendations: vi.fn(),
}))
vi.mock("@/lib/db/google-ads-automation-log", () => ({ insertAutomationLog: vi.fn() }))
vi.mock("@/lib/db/google-ads-ad-groups", () => ({ resolveAdGroupByExternalId: vi.fn() }))
vi.mock("@/lib/db/google-ads-keywords", () => ({ resolveKeywordExternalIds: vi.fn() }))
vi.mock("@/lib/db/google-ads-ads", () => ({ resolveAdExternalIds: vi.fn() }))
vi.mock("@/lib/ads/google-ads-rest", () => ({ mutateResourcesRest: vi.fn() }))
vi.mock("@/lib/ads/tracking-verification", () => ({ verifyTrackingForBlueprint: vi.fn() }))
vi.mock("@/lib/ads/geo-target-resolver", () => ({
  resolveGeoTargets: vi.fn(),
  validateGeoCoverage: vi.fn(),
}))

import { buildMutation } from "@/lib/ads/apply"

const INTERNAL_UUID = "b5d033e6-9ece-4d26-92b9-40a1ce8119b6"
const EXTERNAL_ID = "23880466454"
const CUSTOMER_ID = "4974459872"

// Verbatim shape from the failed prod rec 1e5623ea.
function makeRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    customer_id: CUSTOMER_ID,
    recommendation_type: "add_negative_keyword",
    scope_type: "campaign",
    scope_id: INTERNAL_UUID,
    payload: {
      args: {
        campaign_id: INTERNAL_UUID,
        match_types: ["EXACT", "PHRASE"],
        negative_keywords: ["sports physical therapy", "pilates", "athletic clearance"],
      },
      tool: "propose_negative_keywords",
    },
    ...overrides,
  } as never
}

describe("buildMutation — add_negative_keyword", () => {
  beforeEach(() => {
    mocks.getCampaignById.mockReset()
    mocks.getCampaignById.mockResolvedValue({ id: INTERNAL_UUID, campaign_id: EXTERNAL_ID })
  })

  it("gives every fanned-out create a UNIQUE temp id (DUPLICATE_TEMP_IDS)", async () => {
    const result = await buildMutation(makeRec())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 3 keywords × 2 match types.
    expect(result.ops).toHaveLength(6)

    const resources = result.ops.map((o) => o.resource)
    expect(new Set(resources).size).toBe(resources.length)

    // Temp ids must count down from -1, never repeat.
    const tempIds = resources.map((r) => String(r).split("~").pop())
    expect(tempIds).toEqual(["-1", "-2", "-3", "-4", "-5", "-6"])
  })

  it("resolves the internal campaign UUID to the external id in resource names", async () => {
    const result = await buildMutation(makeRec())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(mocks.getCampaignById).toHaveBeenCalledWith(INTERNAL_UUID)
    for (const op of result.ops) {
      // The UUID must never reach a Google resource name.
      expect(op.campaign).toBe(`customers/${CUSTOMER_ID}/campaigns/${EXTERNAL_ID}`)
      expect(String(op.resource)).not.toContain(INTERNAL_UUID)
      expect(op.negative).toBe(true)
    }
  })

  it("passes an external scope_id straight through without a mirror lookup", async () => {
    const result = await buildMutation(
      makeRec({ scope_id: EXTERNAL_ID, payload: { text: "free", match_type: "BROAD" } }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(mocks.getCampaignById).not.toHaveBeenCalled()
    expect(result.ops).toHaveLength(1)
    expect(result.ops[0].keyword).toEqual({ text: "free", match_type: "BROAD" })
  })

  it("fails cleanly when the campaign is missing from the mirror", async () => {
    mocks.getCampaignById.mockResolvedValue(null)
    const result = await buildMutation(makeRec())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/not found in mirror/i)
  })
})
