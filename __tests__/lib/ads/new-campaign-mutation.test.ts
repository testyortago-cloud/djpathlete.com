import { describe, expect, it } from "vitest"
import {
  buildNewCampaignOps,
  toAbsoluteFinalUrl,
} from "@/lib/ads/new-campaign-mutation"
import type { CampaignBlueprintArgs } from "@/lib/ads/agent/decision-schema"
import type { ResolvedGeoTarget } from "@/lib/ads/geo-target-resolver"

const CUSTOMER_ID = "1234567890"

function blueprint(overrides: Partial<CampaignBlueprintArgs> = {}): CampaignBlueprintArgs {
  return {
    inventory_ref: "comeback-code",
    inventory_kind: "product",
    campaign_type: "SEARCH",
    campaign_name: "Comeback Code — Search — Lead-gen",
    daily_budget_cents: 1500,
    geo_targets: ["Phoenix, AZ"],
    keyword_themes: [
      {
        theme: "comeback training",
        match_type: "PHRASE",
        keywords: ["comeback training program", "return to sport training"],
      },
      {
        theme: "rotational power",
        match_type: "EXACT",
        keywords: ["rotational power training", "baseball rotational power"],
      },
    ],
    negative_seed: ["free", "diy", "cheap"],
    ad_copy: {
      headlines: [
        "Return Stronger Than Before",
        "Coach-Led Comeback Plans",
        "Rebuild Rotational Power",
      ],
      descriptions: [
        "12-week structured comeback for injured athletes.",
        "Personalized programming. Real coach. Real results.",
      ],
      final_url: "https://www.darrenjpaul.com/programs/comeback-code",
    },
    conversion_goal: "form_submission_lead",
    supporting_gaql_evidence: [
      {
        gaql: "SELECT campaign.id FROM campaign LIMIT 1",
        finding: "Account is active and has enabled campaigns.",
      },
    ],
    ...overrides,
  }
}

describe("buildNewCampaignOps", () => {
  it("rejects non-SEARCH campaign types", () => {
    expect(() => buildNewCampaignOps(CUSTOMER_ID, blueprint({ campaign_type: "PMAX" }))).toThrow(
      /only supports SEARCH/i,
    )
    expect(() =>
      buildNewCampaignOps(CUSTOMER_ID, blueprint({ campaign_type: "DISPLAY" })),
    ).toThrow(/only supports SEARCH/i)
  })

  it("emits ops in dependency order: budget → campaign → criteria → ad groups → keywords/ads", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const entities = ops.map((o) => o.entity)
    // Budget must come before campaign
    expect(entities.indexOf("campaign_budget")).toBeLessThan(entities.indexOf("campaign"))
    // Campaign must come before ad_group and any campaign_criterion
    const firstCampaignCriterion = entities.indexOf("campaign_criterion")
    const firstAdGroup = entities.indexOf("ad_group")
    expect(entities.indexOf("campaign")).toBeLessThan(firstCampaignCriterion)
    expect(entities.indexOf("campaign")).toBeLessThan(firstAdGroup)
    // Ad group must come before its children
    const firstAdGroupCriterion = entities.indexOf("ad_group_criterion")
    const firstAdGroupAd = entities.indexOf("ad_group_ad")
    expect(firstAdGroup).toBeLessThan(firstAdGroupCriterion)
    expect(firstAdGroup).toBeLessThan(firstAdGroupAd)
  })

  it("creates the campaign as PAUSED with manual CPC and search-network only", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const campaign = ops.find((o) => o.entity === "campaign")
    expect(campaign).toBeDefined()
    expect(campaign?.status).toBe("PAUSED")
    expect(campaign?.advertising_channel_type).toBe("SEARCH")
    expect(campaign?.bidding_strategy_type).toBe("MANUAL_CPC")
    expect(campaign?.manual_cpc).toBeDefined()
    expect(campaign?.network_settings).toMatchObject({
      target_google_search: true,
      target_content_network: false,
    })
    // EU political advertising flag is required since 2025 — must be present
    // on every campaign create or REST returns fieldError: REQUIRED.
    expect(campaign?.contains_eu_political_advertising).toBe(
      "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    )
    // YYYY-MM-DD format (REST), not YYYYMMDD (gRPC proto).
    expect(campaign?.start_date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("omits resource_name on leaf ops (criteria, keywords, RSAs) but keeps it on parents", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    // Parents: budget, campaign, ad_group → must have resource_name (referenced by children).
    for (const entity of ["campaign_budget", "campaign", "ad_group"]) {
      const op = ops.find((o) => o.entity === entity)
      expect(op?.resource).toBeTruthy()
    }
    // Leaves: campaign_criterion, ad_group_criterion, ad_group_ad → must NOT
    // have resource_name (composite temp IDs trigger INCONSISTENT_FIELD_VALUES).
    for (const op of ops.filter((o) =>
      ["campaign_criterion", "ad_group_criterion", "ad_group_ad"].includes(o.entity),
    )) {
      expect(op.resource).toBeUndefined()
    }
  })

  it("converts daily_budget_cents to micros correctly", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint({ daily_budget_cents: 2500 }))
    const budget = ops.find((o) => o.entity === "campaign_budget")
    // 2500 cents = $25 = 25_000_000 micros
    expect(budget?.amount_micros).toBe(25_000_000)
  })

  it("creates one ad group + one RSA per keyword theme, with all theme keywords", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const adGroups = ops.filter((o) => o.entity === "ad_group")
    const adGroupAds = ops.filter((o) => o.entity === "ad_group_ad")
    expect(adGroups).toHaveLength(2)
    expect(adGroupAds).toHaveLength(2)
    expect(adGroups.map((g) => g.name).sort()).toEqual(
      ["comeback training", "rotational power"].sort(),
    )
    const keywords = ops.filter(
      (o) =>
        o.entity === "ad_group_criterion" &&
        (o as { keyword?: { text: string } }).keyword !== undefined,
    )
    // 2 keywords per theme × 2 themes = 4 keyword ops
    expect(keywords).toHaveLength(4)
  })

  it("marks ad groups PAUSED so nothing serves even if a keyword is enabled", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    for (const op of ops.filter((o) => o.entity === "ad_group")) {
      expect(op.status).toBe("PAUSED")
    }
    for (const op of ops.filter((o) => o.entity === "ad_group_ad")) {
      expect(op.status).toBe("PAUSED")
    }
  })

  it("emits campaign-scope negative keywords with BROAD match", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const negatives = ops.filter(
      (o) =>
        o.entity === "campaign_criterion" &&
        (o as { negative?: boolean }).negative === true,
    )
    expect(negatives).toHaveLength(3) // matches blueprint.negative_seed.length
    for (const n of negatives) {
      expect((n as { keyword: { match_type: string } }).keyword.match_type).toBe("BROAD")
    }
  })

  it("emits English language criterion", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const langOp = ops.find(
      (o) =>
        o.entity === "campaign_criterion" &&
        (o as { language?: { language_constant: string } }).language?.language_constant ===
          "languageConstants/1000",
    )
    expect(langOp).toBeDefined()
  })

  it("uses match_type from the theme for each keyword", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const keywords = ops.filter(
      (o) =>
        o.entity === "ad_group_criterion" &&
        (o as { keyword?: unknown }).keyword !== undefined,
    ) as Array<{ keyword: { text: string; match_type: string } }>
    const phraseTextSet = new Set(["comeback training program", "return to sport training"])
    const exactTextSet = new Set(["rotational power training", "baseball rotational power"])
    for (const kw of keywords) {
      if (phraseTextSet.has(kw.keyword.text)) {
        expect(kw.keyword.match_type).toBe("PHRASE")
      } else if (exactTextSet.has(kw.keyword.text)) {
        expect(kw.keyword.match_type).toBe("EXACT")
      }
    }
  })

  it("emits no geo criteria when geoTargets option is empty (worldwide)", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const locationOps = ops.filter(
      (o) =>
        o.entity === "campaign_criterion" &&
        (o as { location?: unknown }).location !== undefined,
    )
    expect(locationOps).toHaveLength(0)
  })

  it("adds one location criterion per resolved geo target", () => {
    const geoTargets: ResolvedGeoTarget[] = [
      {
        source: "Tampa Bay, FL",
        resource_name: "geoTargetConstants/1015218",
        target_type: "Metro",
        canonical_name: "Tampa-St. Petersburg (Sarasota), FL, US",
      },
      {
        source: "US",
        resource_name: "geoTargetConstants/2840",
        target_type: "Country",
        canonical_name: "United States",
      },
    ]
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint(), { geoTargets })
    const locationOps = ops.filter(
      (o) =>
        o.entity === "campaign_criterion" &&
        (o as { location?: unknown }).location !== undefined,
    ) as Array<{ location: { geo_target_constant: string } }>
    expect(locationOps).toHaveLength(2)
    expect(locationOps.map((o) => o.location.geo_target_constant).sort()).toEqual(
      ["geoTargetConstants/1015218", "geoTargetConstants/2840"].sort(),
    )
  })

  it("attaches selective_optimization when conversionActionResource is provided", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint(), {
      conversionActionResource: "customers/1234567890/conversionActions/9999",
    })
    const campaign = ops.find((o) => o.entity === "campaign") as {
      selective_optimization?: { conversion_actions: string[] }
    }
    expect(campaign.selective_optimization).toBeDefined()
    expect(campaign.selective_optimization?.conversion_actions).toEqual([
      "customers/1234567890/conversionActions/9999",
    ])
  })

  it("omits selective_optimization when no conversionActionResource (account-level inherit)", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const campaign = ops.find((o) => o.entity === "campaign") as {
      selective_optimization?: unknown
    }
    expect(campaign.selective_optimization).toBeUndefined()
  })

  describe("toAbsoluteFinalUrl", () => {
    it("leaves absolute URLs unchanged", () => {
      expect(toAbsoluteFinalUrl("https://example.com/x")).toBe("https://example.com/x")
      expect(toAbsoluteFinalUrl("HTTP://example.com")).toBe("HTTP://example.com")
    })
    it("prepends the production origin to a leading-slash path", () => {
      expect(toAbsoluteFinalUrl("/programs/rotational-reboot")).toBe(
        "https://www.darrenjpaul.com/programs/rotational-reboot",
      )
    })
    it("normalizes a path missing the leading slash", () => {
      expect(toAbsoluteFinalUrl("programs/rotational-reboot")).toBe(
        "https://www.darrenjpaul.com/programs/rotational-reboot",
      )
    })
  })

  it("converts relative final_url to absolute on every RSA so Google Ads accepts it", () => {
    const ops = buildNewCampaignOps(
      CUSTOMER_ID,
      blueprint({
        ad_copy: {
          headlines: ["A", "B", "C"],
          descriptions: ["D1", "D2"],
          final_url: "/programs/rotational-reboot", // relative — agent stores these
        },
      }),
    )
    const rsas = ops.filter((o) => o.entity === "ad_group_ad") as Array<{
      ad: { final_urls: string[] }
    }>
    for (const r of rsas) {
      expect(r.ad.final_urls[0]).toBe(
        "https://www.darrenjpaul.com/programs/rotational-reboot",
      )
    }
  })

  it("attaches the ad copy headlines and descriptions to every RSA", () => {
    const ops = buildNewCampaignOps(CUSTOMER_ID, blueprint())
    const rsas = ops.filter((o) => o.entity === "ad_group_ad") as Array<{
      ad: {
        final_urls: string[]
        responsive_search_ad: {
          headlines: Array<{ text: string }>
          descriptions: Array<{ text: string }>
        }
      }
    }>
    for (const rsa of rsas) {
      expect(rsa.ad.final_urls).toEqual(["https://www.darrenjpaul.com/programs/comeback-code"])
      expect(rsa.ad.responsive_search_ad.headlines).toHaveLength(3)
      expect(rsa.ad.responsive_search_ad.descriptions).toHaveLength(2)
    }
  })
})
