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

import { requireAdmin } from "@/lib/auth-helpers"
import { getBusinessSettings } from "@/lib/db/businesses"
import { readCampaignRevenue } from "@/lib/automation/campaign-revenue"
import Page from "@/app/(admin)/admin/insights/campaign-revenue/page"

const BUSINESS = { display_name: "Acme Coaching" }

async function renderPage() {
  render(await Page())
}

function table(): HTMLElement {
  return screen.getByRole("table")
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue(BUSINESS)
})

describe("campaign revenue page", () => {
  it("renders the empty state, not a fabricated zero row, when nothing has won yet", async () => {
    ;(readCampaignRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await renderPage()
    expect(screen.getByText(/No won deals yet/)).toBeInTheDocument()
    expect(screen.queryByText("Unattributed")).not.toBeInTheDocument()
    // The launch-expectation note is on the page regardless of data.
    expect(screen.getByText(/nothing to back-fill/i)).toBeInTheDocument()
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
    await expect(Page()).rejects.toThrow("db unreachable")
  })
})
