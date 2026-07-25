// The print view is the THIRD CPA-facing rendering of the fee/net line (after
// ReportsClient and the xlsx pack) and it resolves `showFees` and its own
// empty-state condition itself. fee-lines.test.ts pins the STRINGS; nothing
// pinned WHICH BOOK gets them or WHEN the table renders at all — and both of
// those decide whether a workbook and the printout for the same window can
// disclose different fee totals. Server component invoked directly, per the
// __tests__/app/content-studio/post-page.test.tsx precedent.
import { render, screen, within } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn(), listAssets: vi.fn() }))
vi.mock("@/components/admin/performance/print-toolbar", () => ({ PrintToolbar: () => <div /> }))

import { auth } from "@/lib/auth"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments, listAssets } from "@/lib/db/bookkeeping"
import Page from "@/app/(admin)/admin/books/reports/print/page"

const BUSINESS = "b0000000-0000-4000-8000-000000000001"
const HOUSEHOLD = "b0000000-0000-4000-8000-000000000002"
const admin = { user: { id: "11111111-2222-4333-8444-555555555555", role: "admin" } }

const businessBook = { id: BUSINESS, name: "Darren — DJP Athlete", owner_label: null, book_kind: "business", is_primary: true, currency: "usd", sort_order: 0 }
const householdBook = { id: HOUSEHOLD, name: "Household", owner_label: null, book_kind: "household", is_primary: false, currency: "usd", sort_order: 1 }

// $1,255.50 of income against $12.55 of fees — a net of $1,242.95 that is not a
// round number and cannot be produced by dropping or doubling either input.
const INCOME = { book_id: BUSINESS, account_id: null, direction: "income", amount_cents: 125_550, occurred_on: "2026-07-02", counterparty: null, memo: null, source: "manual" }
const FEE_LINE = { txn_date: "2026-07-02", fee_cents: 1_255, payout_id: "po_1", fees_reconciled: true }
const PAYOUT = { id: "po_1", fees_reconciled: true }

function bundle(over: Record<string, unknown> = {}) {
  return { books: [businessBook, householdBook], accounts: [], entries: [INCOME], payoutLines: [FEE_LINE], payouts: [PAYOUT], ...over }
}

async function renderPrint(qs: { from?: string; to?: string } = { from: "2026-07-01", to: "2026-07-31" }) {
  render(await Page({ searchParams: Promise.resolve(qs) }))
}

/** The "Income by service — …" section, which owns the fee/net block. */
function incomeSection(): HTMLElement {
  return screen.getByRole("heading", { name: /^Income by service —/ }).closest("section")!
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(listAssets as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(bundle())
})

describe("accountant-pack print view — fee / net block", () => {
  it("nets the ingested fee off GROSS income, not off P&L net", async () => {
    await renderPrint()
    const section = within(incomeSection())
    expect(section.getByText("Total gross income").closest("tr")).toHaveTextContent("$1,255.50")
    expect(section.getByText(/Stripe processing fees/).closest("tr")).toHaveTextContent("−$12.55")
    expect(section.getByText(/Net income after Stripe fees/).closest("tr")).toHaveTextContent("$1,242.95")
  })

  it("never restates gross as net when no payout has been ingested", async () => {
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(bundle({ payoutLines: [], payouts: [] }))
    await renderPrint()
    const section = within(incomeSection())
    expect(section.getByText(/Stripe processing fees/).closest("tr")).toHaveTextContent("no payouts ingested")
    const net = section.getByText(/Net income after Stripe fees/).closest("tr")!
    expect(net).toHaveTextContent("available after the first payout sync")
    // The falsehood this guards: printing the gross figure under a "net" label.
    expect(net).not.toHaveTextContent("$1,255.50")
  })

  it("carries the incomplete-fees caveat into BOTH cells", async () => {
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(
      bundle({ payouts: [PAYOUT, { id: "po_manual", fees_reconciled: false }] }),
    )
    await renderPrint()
    const section = within(incomeSection())
    expect(section.getByText(/Stripe processing fees/).closest("tr")).toHaveTextContent("fees incomplete for 1 of 2 payouts")
    expect(section.getByText(/Net income after Stripe fees/).closest("tr")).toHaveTextContent("fees incomplete for 1 of 2 payouts")
  })

  it("prints NO fee lines when the primary book is not the business book", async () => {
    // Fees only ever belong to the primary BUSINESS book. If the primary flag
    // sits on a household book, netting the coach's Stripe fees out of that
    // book's income would be a fabricated number on a CPA-facing page.
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(
      bundle({
        books: [{ ...householdBook, is_primary: true }, { ...businessBook, is_primary: false }],
        entries: [{ ...INCOME, book_id: HOUSEHOLD }],
      }),
    )
    await renderPrint()
    const section = within(incomeSection())
    expect(section.getByText("Total gross income")).toBeInTheDocument()
    expect(section.queryByText(/Stripe processing fees/)).not.toBeInTheDocument()
    expect(section.queryByText(/Net income after Stripe fees/)).not.toBeInTheDocument()
  })

  it("still prints the table when fees exist but no income was posted (xlsx parity)", async () => {
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(bundle({ entries: [] }))
    await renderPrint()
    const section = within(incomeSection())
    expect(section.queryByText("No income recorded in this period.")).not.toBeInTheDocument()
    expect(section.getByText("Total gross income").closest("tr")).toHaveTextContent("$0.00")
    expect(section.getByText(/Stripe processing fees/).closest("tr")).toHaveTextContent("−$12.55")
    // Gross 0 − fee 1255 = −$12.55: the window genuinely cost more than it earned.
    expect(section.getByText(/Net income after Stripe fees/).closest("tr")).toHaveTextContent("-$12.55")
  })

  it("falls back to the empty state when there is neither income nor payout data", async () => {
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(
      bundle({ entries: [], payoutLines: [], payouts: [] }),
    )
    await renderPrint()
    expect(within(incomeSection()).getByText("No income recorded in this period.")).toBeInTheDocument()
  })

  it("windows fees by balance-txn date, so an out-of-window line never reaches the printout", async () => {
    ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue(
      bundle({ payoutLines: [{ ...FEE_LINE, txn_date: "2026-08-01" }], payouts: [] }),
    )
    await renderPrint()
    const section = within(incomeSection())
    expect(section.getByText(/Stripe processing fees/).closest("tr")).toHaveTextContent("no payouts ingested")
  })
})
