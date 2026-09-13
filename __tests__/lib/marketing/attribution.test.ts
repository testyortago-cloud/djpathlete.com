import { describe, it, expect } from "vitest"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam, landingUrlFor } from "@/lib/marketing/attribution"

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

describe("landingUrlFor", () => {
  // Exported for proxy.ts, which needs the same landing_url an ad click would
  // have produced for a /go visitor who arrived with no tracking param at all
  // (audit §3.5). It exists so the middleware does not hand-roll the clip and
  // drift from extractTrackingParamsFromUrl's own.
  it("is the origin plus pathname, with the query and fragment dropped", () => {
    expect(landingUrlFor(new URL("https://x.example/go/camp?utm_source=ig&x=1#top"))).toBe("https://x.example/go/camp")
  })

  it("clips to the 2000-char cap the schema enforces", () => {
    // MUTANT KILLED: clipping at MAX_PARAM_LEN (200) instead of MAX_URL_LEN,
    // or not clipping at all — landing_url is `z.string().url().max(2000)`, so
    // an over-long path would make the track route 400 the whole body.
    const long = "a".repeat(3000)
    expect(landingUrlFor(new URL(`https://x.example/go/${long}`)).length).toBe(2000)
  })

  it("agrees with extractTrackingParamsFromUrl's own landing_url", () => {
    const url = new URL("https://x.example/go/camp?gclid=abc")
    expect(extractTrackingParamsFromUrl(url).landing_url).toBe(landingUrlFor(url))
  })
})
