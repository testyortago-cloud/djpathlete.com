// @vitest-environment node
//
// The "Book a call" control on a public page. The property that matters is not
// that a link comes back — it is that the click ids survive the ROUND TRIP.
// Calendly returns only its own utm_* fields on the booking webhook, so a raw
// ?gclid= would reach Calendly and never come back, and the booking would look
// organic while an ad paid for it. encodeTracking packs the ids into utm_content
// in exactly the shape decodeTracking unpacks on the other side.
import { describe, it, expect } from "vitest"
import { consultHref } from "@/lib/calendly/links"
import { decodeTracking } from "@/lib/calendly/tracking"

const PAGE = "https://calendly.com/coach/consult"

describe("consultHref", () => {
  it("returns null with no scheduling page, so a caller renders nothing rather than a dead button", () => {
    expect(consultHref(null)).toBeNull()
    expect(consultHref(undefined)).toBeNull()
    expect(consultHref("   ")).toBeNull()
  })

  it("links to the scheduling page when there is one", () => {
    expect(consultHref(PAGE)).toContain(PAGE)
  })

  it("SURVIVES THE ROUND TRIP: what it encodes, the booking webhook decodes back", () => {
    const href = consultHref(PAGE, { gclid: "abc123", fbclid: "fb789" })
    const params = Object.fromEntries(new URL(href!).searchParams)

    // The webhook receives Calendly's payload.tracking, which is these utm_*
    // fields. Feed them straight back through the real decoder.
    const decoded = decodeTracking(params)
    expect(decoded.gclid).toBe("abc123")
    expect(decoded.fbclid).toBe("fb789")
  })

  it("does NOT leak a raw gclid parameter — it would never come back", () => {
    const href = consultHref(PAGE, { gclid: "abc123" })
    expect(new URL(href!).searchParams.get("gclid")).toBeNull()
  })

  it("keeps parameters the scheduling page already carries", () => {
    const href = consultHref(`${PAGE}?month=2026-09`, { gclid: "abc123" })
    expect(new URL(href!).searchParams.get("month")).toBe("2026-09")
  })
})

describe("consultHref attribution labelling", () => {
  it("labels a page booking as its own medium, NOT the assistant's", () => {
    const params = new URL(consultHref(PAGE, { gclid: "g" })!).searchParams
    expect(params.get("utm_medium")).toBe("contact-page")
    expect(params.get("utm_medium")).not.toBe("chat")
  })

  it("still round-trips after the medium changes — decode reads content, not medium", () => {
    const params = Object.fromEntries(new URL(consultHref(PAGE, { gclid: "g" })!).searchParams)
    expect(decodeTracking(params).gclid).toBe("g")
  })
})
