import { describe, it, expect } from "vitest"
import { STATIC_FAQ_PAGES, resolveFaqPage } from "@/lib/faq/pages"

describe("FAQ page registry", () => {
  it("includes the /faq page in the static list", () => {
    const faqPage = STATIC_FAQ_PAGES.find((p) => p.key === "faq")
    expect(faqPage).toBeDefined()
    expect(faqPage!.routePath).toBe("/faq")
    expect(faqPage!.supportsCategories).toBe(true)
  })

  it("resolveFaqPage returns the entry for a known key", () => {
    expect(resolveFaqPage("online")?.routePath).toBe("/online")
  })

  it("resolveFaqPage returns undefined for an unknown key", () => {
    expect(resolveFaqPage("does-not-exist")).toBeUndefined()
  })
})
