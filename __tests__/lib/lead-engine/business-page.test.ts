// @vitest-environment node
// G49: the identity an unsubscribe or SMS-consent page shows is the token's
// business's, read from its settings the way its sequence emails read it.
import { describe, expect, it, vi } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"

const getBusinessSettings = vi.fn()
vi.mock("@/lib/db/businesses", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/businesses")>("@/lib/db/businesses")),
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}))

import { businessPageIdentity, loadBusinessPageIdentity } from "@/lib/lead-engine/business-page"

function settings(patch: Partial<BusinessSettings>): BusinessSettings {
  return {
    business_id: "b1",
    display_name: "Trailhead Strength",
    sender_name: "Sam Rivera",
    sender_email: "sam@example.com",
    reply_to: null,
    logo_url: null,
    postal_address: "12 Ridge Rd, Boulder, CO",
    brand_color: null,
    accent_color: null,
    ...patch,
  } as BusinessSettings
}

describe("businessPageIdentity", () => {
  it("names the business, its sender and its address", () => {
    expect(businessPageIdentity(settings({}))).toMatchObject({
      displayName: "Trailhead Strength",
      senderName: "Sam Rivera",
      postalAddress: "12 Ridge Rd, Boulder, CO",
      logoUrl: null,
    })
  })

  it("reads blank strings as missing: the sender falls back to the business name, the address is left out", () => {
    const id = businessPageIdentity(settings({ sender_name: "  ", postal_address: "", logo_url: "" }))
    expect(id).toMatchObject({ senderName: "Trailhead Strength", postalAddress: null, logoUrl: null })
  })

  it("keeps a logo only when it is an https address", () => {
    expect(businessPageIdentity(settings({ logo_url: "https://cdn.example.com/logo.png" }))?.logoUrl).toBe(
      "https://cdn.example.com/logo.png",
    )
    expect(businessPageIdentity(settings({ logo_url: "javascript:alert(1)" }))?.logoUrl).toBeNull()
    // Plain http would be blocked on an https page, leaving a broken image where the name should be.
    expect(businessPageIdentity(settings({ logo_url: "http://cdn.example.com/logo.png" }))?.logoUrl).toBeNull()
  })

  it("uses the business's own brand colour, the same palette its emails use", () => {
    const own = businessPageIdentity(settings({ brand_color: "#2f5d3a" }))!
    const none = businessPageIdentity(settings({}))!
    expect(own.palette.brand).toBe("#2f5d3a")
    expect(none.palette.brand).not.toBe("#2f5d3a")
    // An unusable stored value falls back exactly like an absent one.
    expect(businessPageIdentity(settings({ brand_color: "red; background:url(x)" }))!.palette).toEqual(none.palette)
  })

  it("has no identity to show without a name, rather than borrowing anyone else's", () => {
    expect(businessPageIdentity(settings({ display_name: "   " }))).toBeNull()
    expect(businessPageIdentity(null)).toBeNull()
  })
})

describe("loadBusinessPageIdentity", () => {
  it("reads the settings of the business it is given", async () => {
    getBusinessSettings.mockResolvedValue(settings({}))
    expect((await loadBusinessPageIdentity("b1"))?.displayName).toBe("Trailhead Strength")
    expect(getBusinessSettings).toHaveBeenCalledWith("b1")
  })

  it("shows no identity, and does not fail the page, when the settings cannot be read", async () => {
    getBusinessSettings.mockRejectedValue(new Error("no settings row"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await loadBusinessPageIdentity("b1")).toBeNull()
  })
})
