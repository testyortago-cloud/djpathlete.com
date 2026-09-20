// @vitest-environment jsdom
// Server component invoked directly, per the
// __tests__/app/content-studio/post-page.test.tsx /
// __tests__/app/admin/books-reports-print-page.test.tsx precedent.
//
// This is the ONE place that actually renders Task 9's page against fixture
// data, rather than reasoning about it from reading the source. The point:
// `readCampaignRevenue`'s own unattributed-bucket contract
// (`isUnattributed === true`, never `unattributedCount > 0`, never a
// positional read) is exercised end to end here, all the way into what a
// browser would actually show — including the one case that must never go
// missing: every deal attributed cleanly, so the bucket row's counts are
// zero but the row itself is still on the page.
import { render, screen, within } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/lib/automation/campaign-revenue", () => ({ readCampaignRevenue: vi.fn() }))
// Task 7: the page now also resolves the tenant for its businessId. Mocked
// here the same way `resolveAdminTenant`'s other page callers are — the real
// implementation reaches `next/headers`, which throws outside a request scope
// in this harness.
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))

import { requireAdmin } from "@/lib/auth-helpers"
import { getBusinessSettings } from "@/lib/db/businesses"
import { readCampaignRevenue } from "@/lib/automation/campaign-revenue"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import Page from "@/app/(admin)/admin/insights/campaign-revenue/page"

const BUSINESS = { display_name: "Acme Coaching" }
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"

/**
 * G15 gave the page a `?days=` window, so it takes `searchParams` like every
 * other filtered admin page. Passed empty here — that is the "All time"
 * default, which is what every assertion below was written against.
 */
const noParams = () => Promise.resolve({})

async function renderPage() {
  render(await Page({ searchParams: noParams() }))
}

function table(): HTMLElement {
  return screen.getByRole("table")
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(BUSINESS)
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: BUSINESS_ID,
    choices: [{ id: BUSINESS_ID, name: "Acme Coaching", slug: "acme" }],
    isOperator: true,
  })
})

describe("campaign revenue page", () => {
  // Does not call renderPage()/render() on purpose — this asserts the VALUE
  // the page passes to its two reads, which does not need a DOM at all. An
  // argument-blind mock would accept a wrong or missing businessId silently.
  it("passes the resolved businessId through to readCampaignRevenue and getBusinessSettings", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await Page({ searchParams: noParams() })
    expect(readCampaignRevenue).toHaveBeenCalledWith(expect.objectContaining({ businessId: BUSINESS_ID }))
    expect(getBusinessSettings).toHaveBeenCalledWith(BUSINESS_ID)
  })

  it("renders the empty state, not a fabricated zero row, when the window held nothing", async () => {
    // G15 widened what empty MEANS. It used to be "nothing won", which hid a
    // window full of leads behind "No won deals yet"; it is now "no leads, no
    // enquiries, no deals", and the copy says all three.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await renderPage()
    expect(screen.getByText(/Nothing in this window yet/)).toBeInTheDocument()
    expect(screen.queryByText("Unattributed")).not.toBeInTheDocument()
    // AND IT SAYS WHY IT IS EMPTY. This is the property the old
    // "nothing to back-fill" assertion was protecting: an empty report that
    // explains itself reads as "there is nothing yet", and one that does not
    // reads as "this page is broken". The sentence moved into the empty state
    // itself when the standing note above the table was replaced by the
    // explanation of the four columns.
    expect(screen.getByText(/Reporting starts at launch/i)).toBeInTheDocument()
  })

  // The case the whole page exists to get right: every won deal attributed
  // cleanly, so the bucket row's own counts are zero — and it must still be
  // its own visible row, not silently absent because "there was nothing to
  // report."
  it("still renders the unattributed row when its counts are zero", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: "google",
        gclid: "Cj0KCQjw-test-1",
        utmCampaign: "spring_promo",
        wonCount: 2,
        wonValueCents: 250_000,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: true,
      },
    ])
    await renderPage()
    const t = within(table())
    expect(t.getByText("Unattributed")).toBeInTheDocument()
    const unattributedRow = t.getByText("Unattributed").closest("tr")!
    // Zero deals, zero value — rendered as real numbers, not blank/omitted.
    expect(within(unattributedRow).getByText("0")).toBeInTheDocument()
    expect(within(unattributedRow).getByText("$0.00")).toBeInTheDocument()
  })

  it("finds the bucket by isUnattributed, not by unattributedCount > 0 or array position", async () => {
    // Bucket row placed FIRST and with unattributedCount explicitly 0 to
    // prove neither "last element" nor "unattributedCount > 0" is how the
    // page locates it — only isUnattributed.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 3,
        wonValueCents: 45_000,
        unattributedCount: 0,
        isUnattributed: true,
      },
      {
        utmSource: "newsletter",
        gclid: "Cj0KCQjw-test-2",
        utmCampaign: "spring_promo",
        wonCount: 1,
        wonValueCents: 10_000,
        unattributedCount: 0,
        isUnattributed: false,
      },
    ])
    await renderPage()
    const t = within(table())
    expect(t.getByText("Unattributed")).toBeInTheDocument()
    const unattributedRow = t.getByText("Unattributed").closest("tr")!
    expect(within(unattributedRow).getByText("$450.00")).toBeInTheDocument()
    expect(t.getByText("spring_promo")).toBeInTheDocument()
  })

  it("does not mislabel a real matched row that itself has null utm fields as Unattributed", async () => {
    // A genuinely matched marketing_attribution row can have null utm_source
    // etc. (e.g. a session captured only a referrer/gclid) — that is a
    // different, real answer from "no match was found at all", and must not
    // render as the Unattributed badge.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 1,
        wonValueCents: 5_000,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: true,
      },
    ])
    await renderPage()
    const t = within(table())
    // Exactly one "Unattributed" badge — the real null-utm row must not also
    // get one.
    expect(t.getAllByText("Unattributed")).toHaveLength(1)
    // The real matched row renders its nulls as an em-dash, not the badge.
    const rows = t.getAllByRole("row")
    // header + 1 real row + 1 bucket row
    expect(rows.length).toBe(3)
  })

  it("formats wonValueCents from cents, not raw", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: "google",
        gclid: "Cj0KCQjw-test-1",
        utmCampaign: "spring_promo",
        wonCount: 1,
        wonValueCents: 123_456,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: true,
      },
    ])
    await renderPage()
    // 123456 cents -> $1,234.56, never "123456" or "$123456.00"
    expect(within(table()).getByText("$1,234.56")).toBeInTheDocument()
    expect(screen.queryByText("123456")).not.toBeInTheDocument()
  })

  it("renders the footer total including unattributed value, and the business's real name (no brand literal)", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: "google",
        gclid: "Cj0KCQjw-test-1",
        utmCampaign: "spring_promo",
        wonCount: 1,
        wonValueCents: 100_00,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        wonCount: 1,
        wonValueCents: 50_00,
        unattributedCount: 1,
        isUnattributed: true,
      },
    ])
    await renderPage()
    expect(screen.getByText("$150.00 total")).toBeInTheDocument()
    expect(screen.getByText(/Acme Coaching/)).toBeInTheDocument()
  })

  it("propagates a failed read instead of rendering an empty report", async () => {
    // A failed read must never look like "nothing won" — letting the error
    // throw (rather than swallowing it into `rows = []`) is what makes the
    // two distinguishable; the admin error boundary is what catches it in
    // the real app.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db unreachable"))
    await expect(Page({ searchParams: noParams() })).rejects.toThrow("db unreachable")
  })

  // business_settings.display_name is seeded as '' (migration 00212 — NOT
  // NULL DEFAULT ''), not null, on any install where the owner hasn't
  // filled in Business Settings yet — including production today. A bare
  // `${display_name}'s business` then rendered as "...produced for 's
  // business" — a stray leading apostrophe with nothing in front of it.
  it("falls back to neutral copy, with no stray leading apostrophe, when display_name is blank", async () => {
    ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "" })
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const { container } = render(await Page({ searchParams: noParams() }))
    const intro = container.querySelector("p")
    expect(intro?.textContent).toMatch(/^What each campaign actually produced for the business/)
    // No "'s"/"'s" standing alone at a word boundary anywhere in the intro
    // — the unconditional-possessive bug renders "...deal in 's pipeline..."
    // (an apostrophe-s token with nothing in front of it).
    expect(intro?.textContent).not.toMatch(/(^|\s)[’']s(\s|$)/)
  })

  it("gives the header one cell per cell in every row, including the bucket", async () => {
    // Three counts that must agree: the header, a campaign row, and the
    // unattributed row. G15 added three columns and the bucket row is the one
    // easiest to forget, because it is written separately from the map above it
    // — and a short row does not error, it silently shifts every number one
    // column left.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: "google",
        gclid: "Cj0-test",
        utmCampaign: "spring_promo",
        landingSlug: null,
        leadCount: 3,
        registrationCount: 2,
        wonCount: 1,
        wonValueCents: 10_000,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        landingSlug: null,
        leadCount: 0,
        registrationCount: 0,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: true,
      },
    ])
    const { container } = render(await Page({ searchParams: noParams() }))

    const headCells = container.querySelectorAll("thead th")
    const bodyRows = container.querySelectorAll('tbody tr[data-slot="data-table-row"]')
    expect(headCells.length).toBe(7)
    expect(bodyRows).toHaveLength(2)
    for (const row of bodyRows) expect(row.querySelectorAll("td").length).toBe(headCells.length)
  })

  it("keeps the click id visible, so two gclid-only campaigns are not both '— / —'", async () => {
    // `gclid` is part of the grouping key, so dropping the column renders two
    // genuinely different campaigns as identical em-dash rows. The DAL's own
    // `gclid` comment records that bug being fixed once already.
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: null,
        gclid: "Cj0-first",
        utmCampaign: null,
        landingSlug: null,
        leadCount: 1,
        registrationCount: 0,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: false,
      },
      {
        utmSource: null,
        gclid: "Cj0-second",
        utmCampaign: null,
        landingSlug: null,
        leadCount: 1,
        registrationCount: 0,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: false,
      },
    ])
    await renderPage()
    const t = within(table())
    expect(t.getByText("Cj0-first")).toBeInTheDocument()
    expect(t.getByText("Cj0-second")).toBeInTheDocument()
  })

  it("names an organic funnel row by its slug rather than as three em-dashes", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        utmSource: null,
        gclid: null,
        utmCampaign: null,
        landingSlug: "athlete-quiz",
        leadCount: 37,
        registrationCount: 0,
        wonCount: 0,
        wonValueCents: 0,
        unattributedCount: 0,
        isUnattributed: false,
      },
    ])
    await renderPage()
    const t = within(table())
    expect(t.getByText("athlete-quiz")).toBeInTheDocument()
    expect(t.getByText("37")).toBeInTheDocument()
    // And it is NOT the unattributed bucket, which is the whole point.
    const row = t.getByText("athlete-quiz").closest("tr")!
    expect(within(row).queryByText("Unattributed")).toBeNull()
  })

  // G15's window selector. The read's `since` is the assertion, not the link
  // styling: a selector that changes what is highlighted without changing what
  // is counted is the failure worth catching.
  describe("the ?days= window", () => {
    const sinceOf = () => (readCampaignRevenue as ReturnType<typeof vi.fn>).mock.calls[0][0].since as Date

    it("reads ALL TIME by default", async () => {
      ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
      await renderPage()
      expect(sinceOf().getTime()).toBe(0)
    })

    it("narrows the read to the last 30 days on ?days=30", async () => {
      ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
      render(await Page({ searchParams: Promise.resolve({ days: "30" }) }))
      const elapsed = Date.now() - sinceOf().getTime()
      // A day either side, so the assertion is about the WINDOW rather than
      // about how long the render took.
      expect(elapsed).toBeGreaterThan(29 * 86_400_000)
      expect(elapsed).toBeLessThan(31 * 86_400_000)
    })

    it("falls back to all time for a window it does not offer, rather than throwing", async () => {
      // `new Date(Date.now() - NaN).toISOString()` THROWS, so an unvalidated
      // day count means a hand-edited URL renders the admin error boundary
      // instead of a report.
      ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
      render(await Page({ searchParams: Promise.resolve({ days: "junk" }) }))
      expect(sinceOf().getTime()).toBe(0)
    })

    it("refuses a NUMERIC window it does not offer — a closed set, not a parsed number", async () => {
      // MUTANT SURVIVED without this. Replacing the closed-set lookup with
      // `Number(requested) || null` passes every other test in this block,
      // because `Number("junk")` is NaN and `NaN || null` is null — the same
      // all-time answer. The two only diverge on a value that PARSES, which is
      // exactly what a hand-edited URL contains: `?days=99999999` would silently
      // become a window nobody offered, and `?days=0.5` a sub-day one.
      ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
      render(await Page({ searchParams: Promise.resolve({ days: "99999999" }) }))
      expect(sinceOf().getTime()).toBe(0)
    })

    it("offers all three windows as links a person can share", async () => {
      ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
      await renderPage()
      expect(screen.getByRole("link", { name: "All time" })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Last 30 days" })).toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Last 90 days" })).toBeInTheDocument()
    })
  })

  it("still renders the possessive when display_name is a real name", async () => {
    ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "Acme Coaching" })
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await renderPage()
    expect(screen.getByText(/What each campaign actually produced for Acme Coaching’s business/)).toBeInTheDocument()
  })
})
