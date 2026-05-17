import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { mutateResourcesRest } from "@/lib/ads/google-ads-rest"
import type { MutationOperation } from "@/lib/ads/new-campaign-mutation"

vi.mock("@/lib/db/platform-connections", () => ({
  getPlatformConnection: vi.fn().mockResolvedValue({
    credentials: { refresh_token: "fake-refresh" },
  }),
}))

const ORIGINAL_ENV = { ...process.env }

describe("mutateResourcesRest", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token"
    process.env.GOOGLE_ADS_CLIENT_ID = "client-id"
    process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret"
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    process.env = { ...ORIGINAL_ENV }
  })

  function mockOauthOnce() {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "test-access" }), { status: 200 }),
    )
  }

  it("returns an empty result without calling Google when ops are empty", async () => {
    const result = await mutateResourcesRest("1234567890", [])
    expect(result.createdCampaignResource).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("posts to the googleAds:mutate endpoint with developer-token and login-customer-id headers", async () => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "9999999999"
    mockOauthOnce()
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mutateOperationResponses: [
            { campaignResult: { resourceName: "customers/123/campaigns/777" } },
          ],
        }),
        { status: 200 },
      ),
    )

    const ops: MutationOperation[] = [
      {
        entity: "campaign",
        operation: "create",
        resource: "customers/123/campaigns/-1",
        name: "test campaign",
        advertising_channel_type: "SEARCH",
        status: "PAUSED",
      },
    ]
    const result = await mutateResourcesRest("123", ops)
    expect(result.createdCampaignResource).toBe("customers/123/campaigns/777")

    // Second call is the mutate POST.
    const mutateCall = fetchSpy.mock.calls[1]
    const url = mutateCall[0] as string
    const init = mutateCall[1] as RequestInit
    expect(url).toBe(
      "https://googleads.googleapis.com/v21/customers/123/googleAds:mutate",
    )
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["developer-token"]).toBe("dev-token")
    expect(headers["login-customer-id"]).toBe("9999999999")
    expect(headers.authorization).toBe("Bearer test-access")
  })

  it("wraps each entity in the correct snakeCaseEntityOperation envelope with camelCase fields", async () => {
    mockOauthOnce()
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ mutateOperationResponses: [] }), { status: 200 }),
    )

    const ops: MutationOperation[] = [
      {
        entity: "campaign_budget",
        operation: "create",
        resource: "customers/123/campaignBudgets/-1",
        name: "test budget",
        amount_micros: 1_500_000,
        delivery_method: "STANDARD",
      },
      {
        entity: "ad_group_criterion",
        operation: "create",
        resource: "customers/123/adGroupCriteria/-1~-2",
        ad_group: "customers/123/adGroups/-1",
        status: "ENABLED",
        keyword: { text: "rotational power", match_type: "PHRASE" },
      },
    ]
    await mutateResourcesRest("123", ops)

    const body = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string) as {
      mutateOperations: Array<Record<string, unknown>>
    }
    expect(body.mutateOperations).toHaveLength(2)

    const budgetOp = body.mutateOperations[0] as {
      campaignBudgetOperation: { create: Record<string, unknown> }
    }
    expect(budgetOp.campaignBudgetOperation.create).toMatchObject({
      resourceName: "customers/123/campaignBudgets/-1",
      name: "test budget",
      amountMicros: 1_500_000, // snake → camel
      deliveryMethod: "STANDARD",
    })

    const criterionOp = body.mutateOperations[1] as {
      adGroupCriterionOperation: { create: Record<string, unknown> }
    }
    expect(criterionOp.adGroupCriterionOperation.create).toMatchObject({
      resourceName: "customers/123/adGroupCriteria/-1~-2",
      adGroup: "customers/123/adGroups/-1", // ad_group → adGroup
      status: "ENABLED",
      keyword: { text: "rotational power", matchType: "PHRASE" }, // nested snake→camel
    })
  })

  it("throws with the API error body when the mutate POST returns non-2xx", async () => {
    mockOauthOnce()
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "Invalid keyword text",
          },
        }),
        { status: 400 },
      ),
    )
    await expect(
      mutateResourcesRest("123", [
        {
          entity: "campaign_budget",
          operation: "create",
          resource: "customers/123/campaignBudgets/-1",
          name: "x",
          amount_micros: 1,
        },
      ]),
    ).rejects.toThrow(/HTTP 400.*Invalid keyword text/s)
  })

  it("throws when no developer token is configured", async () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN
    await expect(
      mutateResourcesRest("123", [
        {
          entity: "campaign_budget",
          operation: "create",
          resource: "customers/123/campaignBudgets/-1",
          name: "x",
          amount_micros: 1,
        },
      ]),
    ).rejects.toThrow(/GOOGLE_ADS_DEVELOPER_TOKEN missing/)
  })
})
