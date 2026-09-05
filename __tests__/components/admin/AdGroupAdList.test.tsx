// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AdGroupAdList, type AdGroupWithAds } from "@/app/(admin)/admin/ads/campaigns/AdGroupAdList"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx (useRouter().refresh is a vi.fn()).

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  }) as unknown as typeof fetch
})

const adGroup: AdGroupWithAds = {
  id: "ag-1",
  campaign_id: "camp-1",
  ad_group_id: "1111",
  name: "Comeback Code — Prospecting",
  status: "ENABLED",
  type: "SEARCH_STANDARD",
  cpc_bid_micros: null,
  raw_data: null,
  last_synced_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ads: [
    {
      id: "ad-1",
      ad_group_id: "ag-1",
      ad_id: "2222",
      type: "RESPONSIVE_SEARCH_AD",
      status: "PAUSED",
      headlines: [{ text: "Get Fit" }],
      descriptions: [],
      final_urls: [],
      raw_data: null,
      last_synced_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
}

describe("<AdGroupAdList>", () => {
  it("renders the ad group name, the ad headline, and one toggle button per resource", () => {
    render(<AdGroupAdList adGroups={[adGroup]} />)

    expect(screen.getByText("Comeback Code — Prospecting")).toBeInTheDocument()
    expect(screen.getByText("Get Fit")).toBeInTheDocument()

    expect(
      screen.getByRole("button", { name: /pause ad group comeback code/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /resume ad get fit/i })).toBeInTheDocument()
  })

  it("shows an empty state when there are no ad groups", () => {
    render(<AdGroupAdList adGroups={[]} />)
    expect(screen.getByText("No ad groups synced.")).toBeInTheDocument()
  })
})
