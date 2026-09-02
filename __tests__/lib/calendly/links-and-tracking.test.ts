// @vitest-environment node
//
// The link a visitor clicks, and the tracking that rides on it and comes back
// on the webhook. The round-trip is the load-bearing test: without it every
// assistant booking fires zero ads conversions and nothing looks wrong.
import { describe, it, expect } from "vitest"

import { schedulingLink } from "@/lib/calendly/links"
import { EMPTY_TRACKING, TRACKING_MEDIUM, TRACKING_SOURCE, decodeTracking, encodeTracking } from "@/lib/calendly/tracking"

const PAGE = "https://calendly.com/acme-performance/consultation"
const SLOT = "https://calendly.com/acme-performance/consultation/2026-09-08T13:00:00Z?month=2026-09&date=2026-09-08"

describe("schedulingLink", () => {
  it("prefills name and email onto the public page", () => {
    const url = new URL(schedulingLink(PAGE, { prefill: { name: "Priya Raman", email: "priya@example.test" } }))
    expect(url.searchParams.get("name")).toBe("Priya Raman")
    expect(url.searchParams.get("email")).toBe("priya@example.test")
    expect(url.origin + url.pathname).toBe(PAGE)
  })

  it("preserves a per-slot URL's own month/date parameters while adding ours", () => {
    const url = new URL(schedulingLink(SLOT, { prefill: { email: "priya@example.test" } }))
    expect(url.searchParams.get("month")).toBe("2026-09")
    expect(url.searchParams.get("date")).toBe("2026-09-08")
    expect(url.searchParams.get("email")).toBe("priya@example.test")
    expect(url.pathname).toBe("/acme-performance/consultation/2026-09-08T13:00:00Z")
  })

  it("adds nothing for a blank or absent prefill", () => {
    expect(schedulingLink(PAGE, { prefill: { name: "  ", email: null } })).toBe(PAGE)
    expect(schedulingLink(PAGE)).toBe(PAGE)
  })

  it("appends tracking parameters", () => {
    const url = new URL(schedulingLink(PAGE, { tracking: { utm_source: "website-assistant", utm_content: "gclid:abc" } }))
    expect(url.searchParams.get("utm_source")).toBe("website-assistant")
    expect(url.searchParams.get("utm_content")).toBe("gclid:abc")
  })

  it("leaves a non-https or relative target alone rather than guessing", () => {
    expect(schedulingLink("/contact", { prefill: { email: "x@y.test" } })).toBe("/contact")
    expect(schedulingLink("http://calendly.com/x", { prefill: { email: "x@y.test" } })).toBe("http://calendly.com/x")
  })
})

describe("tracking round-trip", () => {
  const CONV = "0f3b2e9a-6c1d-4f0e-9b7a-2c4d6e8f0a1b"

  it("carries every click id and the conversation id through Calendly's tracking object", () => {
    const params = encodeTracking({ gclid: "TeSt_gclid-123", gbraid: "gb1", wbraid: "wb1", fbclid: "fb1", conversationId: CONV })
    expect(params.utm_source).toBe(TRACKING_SOURCE)
    expect(params.utm_medium).toBe(TRACKING_MEDIUM)
    // What Calendly echoes back on the webhook is exactly these values.
    const decoded = decodeTracking({ ...params, utm_campaign: null, salesforce_uuid: null })
    expect(decoded).toEqual({ gclid: "TeSt_gclid-123", gbraid: "gb1", wbraid: "wb1", fbclid: "fb1", conversationId: CONV })
  })

  it("omits utm_content and utm_term when there is nothing to carry", () => {
    const params = encodeTracking({})
    expect(params).toEqual({ utm_source: TRACKING_SOURCE, utm_medium: TRACKING_MEDIUM })
  })

  it("drops a click id that is not URL-safe rather than encoding it", () => {
    const params = encodeTracking({ gclid: "abc;gbraid:evil", gbraid: "fine_1" })
    expect(params.utm_content).toBe("gbraid:fine_1")
  })

  it("drops a conversation id that is not a UUID", () => {
    expect(encodeTracking({ conversationId: "not-a-uuid" }).utm_term).toBeUndefined()
  })

  it("decodes somebody else's UTMs (an ads landing page) to all-null", () => {
    expect(decodeTracking({ utm_source: "google", utm_medium: "cpc", utm_content: "ad-variant-b", utm_term: "speed training" })).toEqual(
      EMPTY_TRACKING,
    )
  })

  it("decodes a missing or non-object tracking to all-null", () => {
    expect(decodeTracking(null)).toEqual(EMPTY_TRACKING)
    expect(decodeTracking("utm_content=gclid:x")).toEqual(EMPTY_TRACKING)
  })

  it("ignores an unknown key inside utm_content and keeps the known ones", () => {
    expect(decodeTracking({ utm_content: "mystery:1;gclid:ok_1" }).gclid).toBe("ok_1")
  })
})
