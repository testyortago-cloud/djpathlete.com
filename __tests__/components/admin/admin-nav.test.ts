import { describe, expect, it } from "vitest"
import { getAdminNav, getAllHrefs } from "@/components/admin/admin-nav"

describe("getAdminNav", () => {
  it("returns the expected top-link count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.topLinks).toHaveLength(2)
  })

  it("returns the expected grouped-section count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.groupedSections).toHaveLength(5)
  })

  it("returns the expected standalone-link count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.standaloneLinks).toHaveLength(1)
  })

  it("has no empty sections", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    for (const section of nav.groupedSections) {
      expect(section.items.length).toBeGreaterThan(0)
    }
  })

  it("has no duplicate hrefs across the entire nav", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const hrefs = getAllHrefs(nav)
    const unique = new Set(hrefs)
    expect(unique.size).toBe(hrefs.length)
  })

  it("has no duplicate hrefs when contentStudioEnabled=true", () => {
    const nav = getAdminNav({ contentStudioEnabled: true })
    const hrefs = getAllHrefs(nav)
    const unique = new Set(hrefs)
    expect(unique.size).toBe(hrefs.length)
  })

  it("swaps Marketing items when contentStudioEnabled=true", () => {
    const off = getAdminNav({ contentStudioEnabled: false })
    const on = getAdminNav({ contentStudioEnabled: true })
    const marketingOff = off.groupedSections.find((s) => s.title === "Marketing")
    const marketingOn = on.groupedSections.find((s) => s.title === "Marketing")
    expect(marketingOff?.items.some((i) => i.label === "Social")).toBe(true)
    expect(marketingOn?.items.some((i) => i.label === "Content Studio")).toBe(true)
    expect(marketingOn?.items.some((i) => i.label === "Social")).toBe(false)
  })

  it("includes Settings in the flattened hrefs", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(getAllHrefs(nav)).toContain("/admin/settings")
  })

  it("includes Dashboard and Inbox in topLinks", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const labels = nav.topLinks.map((l) => l.label)
    expect(labels).toContain("Dashboard")
    expect(labels).toContain("Inbox")
  })

  it("includes Strategy in standaloneLinks", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.standaloneLinks.map((l) => l.label)).toContain("Strategy")
  })

  it("every href begins with /admin/", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    for (const href of getAllHrefs(nav)) {
      expect(href.startsWith("/admin/") || href === "/admin/settings").toBe(true)
    }
  })

  it("marks Coaching as pinned (always expanded)", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const coaching = nav.groupedSections.find((s) => s.title === "Coaching")
    expect(coaching?.pinned).toBe(true)
  })

  it("non-pinned sections do not have pinned=true", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const nonPinned = nav.groupedSections.filter((s) => s.title !== "Coaching")
    for (const section of nonPinned) {
      expect(section.pinned).not.toBe(true)
    }
  })
})
