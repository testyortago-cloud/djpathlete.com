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

  // THIS BLOCK HAS BEEN REWRITTEN TWICE, and both times the PREMISE moved
  // rather than the guarantee.
  //
  // 1. Originally there was a top-level "Quizzes" sidebar item, on the reason
  //    that a quiz is pointed at by id and nested under no one funnel, so
  //    nothing would lead you to it.
  // 2. Then the sidebar item went and the funnels board carried an "All
  //    quizzes" link to a list screen, so the quiz was reached from Funnels.
  // 3. Now the list screen is gone too, and this is why: a quiz is not a thing
  //    this product HAS beside funnels, it is something a funnel RUNS. A
  //    standing list made it a permanent top-level concept for every customer,
  //    including the ones being white-labelled who have no quizzes at all.
  //
  // THE GUARANTEE IS UNCHANGED THROUGHOUT: a quiz must never be reachable only
  // by typing its URL. What secures it now is the control on the card of the
  // funnel that runs it, so the test reads the board for that wiring. Delete
  // the wiring and this fails, exactly as deleting the sidebar item used to.
  //
  // What made dropping the LIST safe is that a quiz cannot come into existence
  // without a funnel: `POST /api/admin/funnels` with the quiz template creates
  // the pair in one call and deletes the quiz if the funnel insert fails. The
  // one way to reach an unreferenced quiz is BACKWARDS — `deleteFunnel` leaves
  // the quiz behind — and that hole is tracked separately. A list screen
  // signposted it; it never fixed it.
  it("does NOT carry a top-level Quizzes item — a quiz is reached from its funnel", () => {
    for (const contentStudioEnabled of [false, true]) {
      const nav = getAdminNav({ contentStudioEnabled })
      expect(
        getAllHrefs(nav),
        `Quizzes is back in the sidebar when contentStudioEnabled=${contentStudioEnabled}`,
      ).not.toContain("/admin/funnels/quizzes")
    }
  })

  it("keeps Funnels in the sidebar, which is the door a quiz is now behind", () => {
    for (const contentStudioEnabled of [false, true]) {
      const nav = getAdminNav({ contentStudioEnabled })
      expect(getAllHrefs(nav)).toContain("/admin/funnels")
    }
  })

  it("and the funnels board hands each card the quiz its funnel runs", () => {
    // Read as SOURCE because the board is a server component that queries the
    // database to render.
    //
    // MATCHED ON THE PROP WIRING, not on the word "quiz". The file also carries
    // a long comment explaining why there is no list any more, and a bare word
    // search would be satisfied by the prose that describes the decision rather
    // than by the code that implements it.
    const fs = require("node:fs") as typeof import("node:fs")
    const board = fs.readFileSync("app/(admin)/admin/funnels/page.tsx", "utf8")
    expect(board, "the board must build the step -> quiz map").toContain("quizUsesInSteps(")
    expect(board, "and hand it to the list").toContain("quizByStepId={quizByStepId}")
  })

  it("and no longer links to a quizzes list, because there is not one", () => {
    // `href="` is part of the match on purpose, for the same prose reason.
    const fs = require("node:fs") as typeof import("node:fs")
    const board = fs.readFileSync("app/(admin)/admin/funnels/page.tsx", "utf8")
    expect(board).not.toContain('href="/admin/funnels/quizzes"')
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
