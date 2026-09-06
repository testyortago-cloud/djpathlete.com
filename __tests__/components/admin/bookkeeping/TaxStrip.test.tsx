// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { TaxStrip } from "@/components/admin/bookkeeping/TaxStrip"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BOOK = "b0000000-0000-4000-8000-000000000001"
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
})

function forecast(over: Record<string, unknown> = {}) {
  return {
    ytd_income_cents: 100_000,
    ytd_expense_cents: 40_000,
    home_office_deduction_cents: null,
    estimated_net_cents: 60_000,
    rate_percent: 20,
    estimated_tax_cents: 12_000,
    next_safe_harbor: { label: "Sep 15, 2026", date: "2026-09-15" },
    ...over,
  }
}

function mockGet(payload: unknown) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/tax-forecast")) {
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    if (String(url).includes("/insights/tax-rate") && init?.method === "PATCH") {
      return new Response(JSON.stringify({ percent: 22 }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

describe("<TaxStrip>", () => {
  it("shows the set-aside estimate, next payment date, and the current rate", async () => {
    mockGet({ business: true, forecast: forecast() })
    render(<TaxStrip bookId={BOOK} />)
    expect(await screen.findByText(/~\$120\.00/)).toBeInTheDocument()
    expect(screen.getByText("Sep 15, 2026")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /rate 20% — change/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /details/i })).toHaveAttribute("href", "/admin/books/insights")
  })

  it("no rate set → inline entry that PATCHes the percent", async () => {
    mockGet({ business: true, forecast: forecast({ rate_percent: null, estimated_tax_cents: null }) })
    render(<TaxStrip bookId={BOOK} />)
    expect(await screen.findByText(/needs one number/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Tax rate percent"), { target: { value: "22" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")
      expect(patch).toBeTruthy()
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ percent: 22 })
    })
  })

  it("rejects an out-of-range rate client-side without calling the API", async () => {
    mockGet({ business: true, forecast: forecast({ rate_percent: null, estimated_tax_cents: null }) })
    render(<TaxStrip bookId={BOOK} />)
    fireEvent.change(await screen.findByLabelText("Tax rate percent"), { target: { value: "250" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")).toBe(false)
    })
  })

  it("renders nothing for a household book", async () => {
    mockGet({ business: false })
    const { container } = render(<TaxStrip bookId={BOOK} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
})
