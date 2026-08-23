import { describe, expect, it } from "vitest"
import { getAdminNav, getAllHrefs } from "@/components/admin/admin-nav"

describe("getAdminNav", () => {
  it("returns the expected top-link count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.topLinks).toHaveLength(3)
  })

  it("keeps Messages (client chat) distinct from Inbox (lead inquiries)", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.topLinks.map((l) => l.href)).toEqual(["/admin/dashboard", "/admin/inbox", "/admin/messages"])
  })

  it("returns the expected grouped-section count", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    expect(nav.groupedSections).toHaveLength(6)
  })

  it("returns the expected standalone links", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    // Pin labels, not just count: "How-to Guide" shipped with the pack
    // payment-links work (fc918bac); the next addition should be a
    // conscious edit here, not a mystery red.
    expect(nav.standaloneLinks.map((l) => l.label)).toEqual(["Strategy", "How-to Guide"])
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

  // Same defect class as the pipeline board below: an admin page reachable
  // only by typing its URL is a page nobody discovers. /admin/chat is the
  // only place a blocked reply can be read, so it has to be findable.
  it("registers the chat assistant list in the Marketing section, under both content flags", () => {
    for (const contentStudioEnabled of [false, true]) {
      const nav = getAdminNav({ contentStudioEnabled })
      const marketing = nav.groupedSections.find((s) => s.title === "Marketing")
      expect(marketing?.items.some((i) => i.href === "/admin/chat")).toBe(true)
    }
  })

  // Final review, Important 2: the Lead Engine pipeline board was URL-only —
  // reachable, but not registered anywhere in the sidebar, so a person
  // navigating the app had no way to discover it.
  it("registers the Lead Engine pipeline board in the Coaching section", () => {
    const nav = getAdminNav({ contentStudioEnabled: false })
    const coaching = nav.groupedSections.find((s) => s.title === "Coaching")
    expect(coaching?.items.some((i) => i.href === "/admin/pipeline")).toBe(true)
  })
})
