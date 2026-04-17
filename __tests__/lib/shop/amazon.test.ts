import { describe, expect, it } from "vitest"
import { buildAffiliateUrl, extractAsin } from "@/lib/shop/amazon"

describe("buildAffiliateUrl", () => {
  it("appends tag when absent", () => {
    const out = buildAffiliateUrl("https://www.amazon.com/dp/B01N5IB20Q", "djp-20")
    expect(out).toContain("tag=djp-20")
    expect(out).toContain("/dp/B01N5IB20Q")
  })

  it("replaces existing tag", () => {
    const out = buildAffiliateUrl(
      "https://www.amazon.com/dp/B01N5IB20Q?tag=other-20",
      "djp-20",
    )
    expect(out).toContain("tag=djp-20")
    expect(out).not.toContain("tag=other-20")
  })

  it("throws on non-amazon host", () => {
    expect(() =>
      buildAffiliateUrl("https://walmart.com/item/1", "djp-20"),
    ).toThrow()
  })

  it("throws on malformed URL", () => {
    expect(() => buildAffiliateUrl("not a url", "djp-20")).toThrow()
  })
})

describe("extractAsin", () => {
  it("extracts from /dp/ path", () => {
    expect(extractAsin("https://www.amazon.com/dp/B01N5IB20Q")).toBe("B01N5IB20Q")
  })

  it("extracts from /gp/product/ path", () => {
    expect(
      extractAsin("https://www.amazon.com/gp/product/B01N5IB20Q/ref=sr"),
    ).toBe("B01N5IB20Q")
  })

  it("returns null when absent", () => {
    expect(extractAsin("https://www.amazon.com/s?k=protein")).toBeNull()
  })
})
