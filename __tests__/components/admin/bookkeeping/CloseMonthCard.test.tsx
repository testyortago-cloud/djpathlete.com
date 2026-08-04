import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CloseMonthCard } from "@/components/admin/bookkeeping/CloseMonthCard"
import type { ReadinessCheck } from "@/lib/bookkeeping/close-readiness"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const BOOK = "b0000000-0000-4000-8000-000000000001"
const fetchMock = vi.fn()

// The card derives its month list from the wall clock, so pin it: "today" is
// 2026-08-04 → the latest closable month is July 2026 (2026-07-01..2026-07-31).
// toFake: ["Date"] ONLY — faking setTimeout too starves waitFor's polling loop,
// which then times out before the readiness fetch has resolved.
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-08-04T12:00:00Z"))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
})

function check(over: Partial<ReadinessCheck> & Pick<ReadinessCheck, "key">): ReadinessCheck {
  return {
    title: over.key,
    severity: "blocker",
    status: "ok",
    count: 0,
    detail: "detail",
    ...over,
  } as ReadinessCheck
}

function readiness(checks: ReadinessCheck[]) {
  const blocking = checks.filter((c) => c.severity === "blocker" && c.status === "flagged").map((c) => c.key)
  return {
    period: "2026-07",
    checks,
    blocking,
    warning: checks.filter((c) => c.severity === "warning" && c.status === "flagged").map((c) => c.key),
    ready: blocking.length === 0,
    totals: { income_cents: 0, expense_cents: 0, net_cents: 0, entry_count: 0 },
  }
}

/** `body` may be a function so a test can serve a different payload per call. */
function mockReadiness(body: unknown | (() => unknown)) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("/closes/readiness")) {
      const payload = typeof body === "function" ? (body as () => unknown)() : body
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

const ALL_OK = [
  check({ key: "uncategorized", title: "Everything categorized" }),
  check({ key: "duplicates", title: "No possible duplicates" }),
  check({ key: "substantiation", title: "Receipts and purposes", severity: "warning" }),
  check({ key: "statement_coverage", title: "Bank statement imported", severity: "warning" }),
  check({ key: "earlier_open", title: "Earlier months closed", severity: "warning", targets: [] }),
]

function renderCard(onFix = vi.fn()) {
  render(<CloseMonthCard bookId={BOOK} closes={[]} onChanged={vi.fn()} onFix={onFix} />)
  return onFix
}

describe("<CloseMonthCard> readiness actions", () => {
  it("a flagged blocker gets an action that hands the page the month it must show", async () => {
    mockReadiness({
      readiness: readiness([
        check({
          key: "duplicates",
          title: "No possible duplicates",
          status: "flagged",
          count: 3,
          detail: "3 possible duplicates touch this month",
        }),
        ...ALL_OK.filter((c) => c.key !== "duplicates"),
      ]),
    })
    const onFix = renderCard()

    fireEvent.click(await screen.findByRole("button", { name: "Open duplicate scan" }))

    expect(onFix).toHaveBeenCalledWith({
      key: "duplicates",
      period: "2026-07",
      from: "2026-07-01",
      to: "2026-07-31",
      label: "July 2026",
    })
  })

  it("passing checks get no action button", async () => {
    mockReadiness({ readiness: readiness(ALL_OK) })
    renderCard()

    // Exact text, not /is ready to close/ — the transient "Checking whether
    // July 2026 is ready to close…" line matches that regex and then unmounts.
    expect(await screen.findByText("July 2026 is ready to close.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Show these entries" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open duplicate scan" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Import a statement" })).not.toBeInTheDocument()
  })

  it("earlier_open is handled in-card: it moves the picker instead of calling onFix", async () => {
    mockReadiness({
      readiness: readiness([
        ...ALL_OK.filter((c) => c.key !== "earlier_open"),
        check({
          key: "earlier_open",
          title: "Earlier months closed",
          severity: "warning",
          status: "flagged",
          count: 2,
          detail: "2 earlier months have entries but are still open (2026-01, 2026-02).",
          targets: ["2026-01", "2026-02"],
        }),
      ]),
    })
    const onFix = renderCard()

    expect(await screen.findByRole("button", { name: /Close July 2026/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Switch to January 2026" }))

    expect(await screen.findByRole("button", { name: /Close January 2026/ })).toBeInTheDocument()
    expect(onFix).not.toHaveBeenCalled()
  })

  it("Re-check re-runs the check against current data and says the verdict out loud", async () => {
    const { toast } = await import("sonner")
    let ready = false
    mockReadiness(() =>
      ready
        ? { readiness: readiness(ALL_OK) }
        : {
            readiness: readiness([
              check({ key: "uncategorized", title: "Everything categorized", status: "flagged", count: 1 }),
              ...ALL_OK.filter((c) => c.key !== "uncategorized"),
            ]),
          },
    )
    renderCard()

    expect(await screen.findByText(/isn't ready/)).toBeInTheDocument()
    const before = fetchMock.mock.calls.length

    ready = true // the coach fixed it in another tab
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }))

    expect(await screen.findByText("July 2026 is ready to close.")).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(before + 1)
    expect(toast.success).toHaveBeenCalledWith("July 2026 is ready to close.")
  })

  it("a 200 with no readiness payload degrades to the retry line instead of crashing the card", async () => {
    mockReadiness({})
    renderCard()

    expect(await screen.findByText(/Couldn't run the readiness check/)).toBeInTheDocument()
    // The card is still mounted — the close control must survive a bad response.
    expect(screen.getByRole("button", { name: /Close July 2026/ })).toBeInTheDocument()
  })
})

describe("<CloseMonthCard> without an onFix handler", () => {
  it("omits the page-owned actions rather than rendering dead buttons", async () => {
    mockReadiness({
      readiness: readiness([
        check({ key: "duplicates", title: "No possible duplicates", status: "flagged", count: 3 }),
        ...ALL_OK.filter((c) => c.key !== "duplicates"),
      ]),
    })
    render(<CloseMonthCard bookId={BOOK} closes={[]} onChanged={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/isn't ready/)).toBeInTheDocument())
    expect(screen.queryByRole("button", { name: "Open duplicate scan" })).not.toBeInTheDocument()
  })
})
