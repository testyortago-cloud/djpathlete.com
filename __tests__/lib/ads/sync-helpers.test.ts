import { describe, it, expect } from "vitest"
import {
  transformCampaignRow,
  transformAdGroupRow,
  transformKeywordRow,
  transformAdRow,
  transformMetricsRow,
  transformSearchTermRow,
} from "@/lib/ads/sync-helpers"

describe("transformCampaignRow", () => {
  it("maps a SEARCH campaign row with budget", () => {
    const row = {
      campaign: {
        id: 111,
        name: "Brand Search",
        advertising_channel_type: "SEARCH",
        status: "ENABLED",
        bidding_strategy_type: "MAXIMIZE_CONVERSIONS",
        start_date: "2026-01-01",
        end_date: null,
      },
      campaign_budget: { amount_micros: 50_000_000 },
    }
    const out = transformCampaignRow(row, "1234567890")
    expect(out.customer_id).toBe("1234567890")
    expect(out.campaign_id).toBe("111")
    expect(out.name).toBe("Brand Search")
    expect(out.type).toBe("SEARCH")
    expect(out.status).toBe("ENABLED")
    expect(out.bidding_strategy).toBe("MAXIMIZE_CONVERSIONS")
    expect(out.budget_micros).toBe(50_000_000)
    expect(out.start_date).toBe("2026-01-01")
    expect(out.end_date).toBeNull()
  })

  it("falls back to UNKNOWN type and REMOVED status on garbage input", () => {
    const out = transformCampaignRow({ campaign: { id: 1, name: "x", status: "WTF" } }, "c1")
    expect(out.type).toBe("UNKNOWN")
    expect(out.status).toBe("REMOVED")
  })

  it("handles missing campaign_budget gracefully", () => {
    const out = transformCampaignRow(
      { campaign: { id: 9, name: "n", advertising_channel_type: "VIDEO", status: "PAUSED" } },
      "c2",
    )
    expect(out.budget_micros).toBeNull()
    expect(out.type).toBe("VIDEO")
  })
})

describe("transformAdGroupRow", () => {
  it("maps an ENABLED ad group with bid", () => {
    const row = {
      ad_group: {
        id: 222,
        name: "Branded keywords",
        status: "ENABLED",
        type: "SEARCH_STANDARD",
        cpc_bid_micros: 1_500_000,
      },
    }
    const out = transformAdGroupRow(row, "local-campaign-1")
    expect(out.campaign_id).toBe("local-campaign-1")
    expect(out.ad_group_id).toBe("222")
    expect(out.name).toBe("Branded keywords")
    expect(out.status).toBe("ENABLED")
    expect(out.cpc_bid_micros).toBe(1_500_000)
  })
})

describe("transformKeywordRow", () => {
  it("maps a PHRASE keyword", () => {
    const row = {
      ad_group_criterion: {
        criterion_id: 333,
        keyword: { text: "darren paul coaching", match_type: "PHRASE" },
        status: "ENABLED",
        cpc_bid_micros: 1_500_000,
      },
    }
    const out = transformKeywordRow(row, "local-ag-1")
    expect(out.ad_group_id).toBe("local-ag-1")
    expect(out.criterion_id).toBe("333")
    expect(out.text).toBe("darren paul coaching")
    expect(out.match_type).toBe("PHRASE")
    expect(out.status).toBe("ENABLED")
  })

  it("falls back to BROAD on unknown match_type", () => {
    const out = transformKeywordRow(
      {
        ad_group_criterion: {
          criterion_id: 1,
          keyword: { text: "x", match_type: "MYSTERY" },
          status: "ENABLED",
        },
      },
      "ag",
    )
    expect(out.match_type).toBe("BROAD")
  })
})

describe("transformAdRow", () => {
  it("flattens responsive search ad headlines/descriptions", () => {
    const row = {
      ad_group_ad: {
        ad: {
          id: 444,
          type: "RESPONSIVE_SEARCH_AD",
          responsive_search_ad: {
            headlines: [{ text: "h1" }, { text: "h2" }, { text: undefined }],
            descriptions: [{ text: "d1" }],
          },
          final_urls: ["https://example.com"],
        },
        status: "ENABLED",
      },
    }
    const out = transformAdRow(row, "local-ag-1")
    expect(out.ad_group_id).toBe("local-ag-1")
    expect(out.ad_id).toBe("444")
    expect(out.type).toBe("RESPONSIVE_SEARCH_AD")
    expect(out.headlines).toEqual([{ text: "h1" }, { text: "h2" }])
    expect(out.descriptions).toEqual([{ text: "d1" }])
    expect(out.final_urls).toEqual(["https://example.com"])
  })
})

describe("transformMetricsRow", () => {
  it("converts Google Ads micros and string-typed counters to numbers", () => {
    const row = {
      segments: { date: "2026-05-01" },
      metrics: {
        impressions: "1234",
        clicks: "56",
        cost_micros: "12345678",
        conversions: "2.5",
        conversions_value: "100.50",
      },
      campaign: { id: 111 },
      ad_group: { id: 222 },
      ad_group_criterion: { criterion_id: 333 },
    }
    const out = transformMetricsRow(row, "1234567890")
    expect(out.customer_id).toBe("1234567890")
    expect(out.campaign_id).toBe("111")
    expect(out.ad_group_id).toBe("222")
    expect(out.keyword_criterion_id).toBe("333")
    expect(out.date).toBe("2026-05-01")
    expect(out.impressions).toBe(1234)
    expect(out.clicks).toBe(56)
    expect(out.cost_micros).toBe(12345678)
    expect(out.conversions).toBe(2.5)
    expect(out.conversion_value).toBe(100.5)
  })

  it("nulls out ad_group_id and keyword_criterion_id at campaign grain", () => {
    const out = transformMetricsRow(
      {
        segments: { date: "2026-05-01" },
        metrics: { impressions: 1, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0 },
        campaign: { id: 111 },
      },
      "c",
    )
    expect(out.ad_group_id).toBeNull()
    expect(out.keyword_criterion_id).toBeNull()
  })
})

describe("transformSearchTermRow", () => {
  it("maps a search_term_view row", () => {
    const row = {
      search_term_view: { search_term: "best coach near me" },
      segments: { date: "2026-05-01" },
      metrics: { impressions: "10", clicks: "1", cost_micros: "500000", conversions: "0" },
      campaign: { id: 111 },
      ad_group: { id: 222 },
    }
    const out = transformSearchTermRow(row, "c1")
    expect(out.search_term).toBe("best coach near me")
    expect(out.impressions).toBe(10)
    expect(out.matched_keyword_id).toBeNull()
  })
})
