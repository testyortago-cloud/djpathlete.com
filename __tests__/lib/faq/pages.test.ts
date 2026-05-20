import { describe, it, expect } from "vitest"
import { STATIC_FAQ_PAGES, getStaticAndTemplatedFaqPages, resolveFaqPage } from "@/lib/faq/pages"

describe("FAQ page registry", () => {
  it("includes the /faq page in the static list", () => {
    const faqPage = STATIC_FAQ_PAGES.find((p) => p.key === "faq")
    expect(faqPage).toBeDefined()
    expect(faqPage!.routePath).toBe("/faq")
    expect(faqPage!.supportsCategories).toBe(true)
  })

  it("derives a page for every sport with key sports/<slug>", () => {
    const pages = getStaticAndTemplatedFaqPages()
    const tennis = pages.find((p) => p.key === "sports/tennis-performance-training")
    expect(tennis).toBeDefined()
    expect(tennis!.routePath).toBe("/sports/tennis-performance-training")
  })

  it("derives a page for every athlete type with key athletes/<slug>", () => {
    const pages = getStaticAndTemplatedFaqPages()
    expect(pages.some((p) => p.key === "athletes/professional")).toBe(true)
  })

  it("resolveFaqPage returns the entry for a known key", () => {
    expect(resolveFaqPage("online")?.routePath).toBe("/online")
  })

  it("resolveFaqPage returns undefined for an unknown key", () => {
    expect(resolveFaqPage("does-not-exist")).toBeUndefined()
  })
})
