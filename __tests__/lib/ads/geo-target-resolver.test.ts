import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { resolveGeoTargets, validateGeoCoverage } from "@/lib/ads/geo-target-resolver"

// Mock the platform-connections DAL so resolveGeoTargets doesn't need a DB.
vi.mock("@/lib/db/platform-connections", () => ({
  getPlatformConnection: vi.fn().mockResolvedValue({
    credentials: { refresh_token: "fake-refresh-token" },
  }),
}))

describe("validateGeoCoverage", () => {
  it("blocks an event campaign with no resolved targets", () => {
    const result = validateGeoCoverage({
      conversion_type: "lead",
      inventory_kind: "event",
      resolved_count: 0,
      unresolved: ["Tampa Bay, FL"],
      source_count: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Tampa Bay/i)
    }
  })

  it("blocks a lead-gen campaign with no resolved targets", () => {
    const result = validateGeoCoverage({
      conversion_type: "lead",
      inventory_kind: "product",
      resolved_count: 0,
      unresolved: [],
      source_count: 0,
    })
    expect(result.ok).toBe(false)
  })

  it("blocks a booking campaign with no resolved targets", () => {
    const result = validateGeoCoverage({
      conversion_type: "booking",
      inventory_kind: "product",
      resolved_count: 0,
      unresolved: [],
      source_count: 0,
    })
    expect(result.ok).toBe(false)
  })

  it("allows a purchase (online program) campaign to ship worldwide when no targets were emitted", () => {
    const result = validateGeoCoverage({
      conversion_type: "purchase",
      inventory_kind: "product",
      resolved_count: 0,
      unresolved: [],
      source_count: 0,
    })
    expect(result.ok).toBe(true)
  })

  it("blocks a purchase campaign that emitted targets but resolved none", () => {
    const result = validateGeoCoverage({
      conversion_type: "purchase",
      inventory_kind: "product",
      resolved_count: 0,
      unresolved: ["Atlantis"],
      source_count: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Atlantis/)
    }
  })

  it("allows any campaign with at least one resolved target", () => {
    for (const conversion_type of ["lead", "booking", "purchase"] as const) {
      for (const inventory_kind of ["product", "event"] as const) {
        const result = validateGeoCoverage({
          conversion_type,
          inventory_kind,
          resolved_count: 1,
          unresolved: [],
          source_count: 1,
        })
        expect(result.ok).toBe(true)
      }
    }
  })
})

describe("resolveGeoTargets — ISO country code path", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    // resolveGeoTargets only hits fetch() for non-country-code entries —
    // verify nothing fires for pure-ISO inputs by spying and asserting count.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ geoTargetConstantSuggestions: [] }), {
        status: 200,
      }),
    )
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("resolves known country codes locally without hitting the API", async () => {
    const { resolved, unresolved } = await resolveGeoTargets(["US", "AU", "GB"])
    expect(unresolved).toEqual([])
    expect(resolved).toHaveLength(3)
    expect(resolved.map((r) => r.resource_name).sort()).toEqual(
      [
        "geoTargetConstants/2840", // US
        "geoTargetConstants/2036", // AU
        "geoTargetConstants/2826", // GB
      ].sort(),
    )
    for (const r of resolved) {
      expect(r.target_type).toBe("Country")
    }
    // Suggest endpoint should NOT have been called for pure country codes.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("treats unknown two-letter codes as free-form and routes them through suggest", async () => {
    // "XX" isn't in the country map; should fall through to suggest API
    // (which our mock returns empty for, so it lands in unresolved).
    const { resolved, unresolved } = await resolveGeoTargets(["XX"])
    expect(resolved).toEqual([])
    expect(unresolved).toEqual(["XX"])
  })

  it("skips empty / whitespace-only entries", async () => {
    const { resolved, unresolved } = await resolveGeoTargets(["", "  ", "US"])
    expect(unresolved).toEqual([])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].resource_name).toBe("geoTargetConstants/2840")
  })
})
