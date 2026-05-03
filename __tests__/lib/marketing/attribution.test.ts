import { describe, it, expect } from "vitest"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam } from "@/lib/marketing/attribution"

describe("extractTrackingParamsFromUrl", () => {
  it("extracts gclid", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p?gclid=abc123"))
    expect(params.gclid).toBe("abc123")
    expect(params.utm_source).toBeUndefined()
  })

  it("extracts all tracking params", () => {
    const url = new URL(
      "https://x.example/p?gclid=g1&gbraid=g2&wbraid=w3&fbclid=f4&utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_term=coach&utm_content=ad1",
    )
    const params = extractTrackingParamsFromUrl(url)
    expect(params.gclid).toBe("g1")
    expect(params.gbraid).toBe("g2")
    expect(params.wbraid).toBe("w3")
    expect(params.fbclid).toBe("f4")
    expect(params.utm_source).toBe("google")
    expect(params.utm_medium).toBe("cpc")
    expect(params.utm_campaign).toBe("launch")
    expect(params.utm_term).toBe("coach")
    expect(params.utm_content).toBe("ad1")
  })

  it("populates landing_url with the URL minus query", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p?gclid=abc"))
    expect(params.landing_url).toBe("https://x.example/p")
  })

  it("returns empty object for URL with no tracking params", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p"))
    expect(params).toEqual({})
  })

  it("truncates oversize values to 200 chars", () => {
    const huge = "x".repeat(500)
    const params = extractTrackingParamsFromUrl(new URL(`https://x.example/p?gclid=${huge}`))
    expect(params.gclid?.length).toBe(200)
  })
})

describe("hasAnyTrackingParam", () => {
  it("returns true when any of the 9 keys is present", () => {
    expect(hasAnyTrackingParam({ gclid: "x" })).toBe(true)
    expect(hasAnyTrackingParam({ utm_source: "google" })).toBe(true)
    expect(hasAnyTrackingParam({ fbclid: "y" })).toBe(true)
  })

  it("returns false when only landing_url/referrer present", () => {
    expect(hasAnyTrackingParam({ landing_url: "x", referrer: "y" })).toBe(false)
  })

  it("returns false on empty object", () => {
    expect(hasAnyTrackingParam({})).toBe(false)
  })
})
