// Deviation from the task brief's literal test snippet: the brief imports
// `@testing-library/user-event`, which is not installed anywhere in this repo
// (not in package.json/package-lock.json, no other test uses it) and adding a
// new dependency isn't among this task's named files to stage. This repo's
// established click-interaction convention in this exact test area
// (InsightsClient-dismissals.test.tsx) is `fireEvent.click` from
// @testing-library/react — a behavior-equivalent, zero-dependency swap for the
// simple click-only interactions this file needs.
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { toast } from "sonner"
import { DuplicateScanDialog } from "@/components/admin/bookkeeping/DuplicateScanDialog"
import { duplicatePairFingerprint } from "@/lib/bookkeeping/finding-fingerprint"
import { pairId } from "@/lib/bookkeeping/duplicate-scan"
import type { BookkeepingAccount } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ID_A = "e0000000-0000-4000-8000-000000000001"
const ID_B = "e0000000-0000-4000-8000-000000000002"
const ID_C = "e0000000-0000-4000-8000-000000000003"

const ACCOUNTS = [
  { id: "acc-1", name: "Equipment" } as BookkeepingAccount,
]

function scanEntry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: "rogue fitness",
    counterparty: null,
    source: "statement_import",
    account_id: "acc-1",
    document_id: null,
    ...over,
  }
}

function pair(a: ReturnType<typeof scanEntry>, b: ReturnType<typeof scanEntry>, over: Record<string, unknown> = {}) {
  return {
    pair_id: pairId(a.id as string, b.id as string),
    fingerprint: duplicatePairFingerprint(a.id as string, b.id as string),
    a,
    b,
    day_gap: 1,
    same_source: false,
    memo_similarity: "similar",
    verdict: { is_duplicate: true, confidence: "high", reason: "same purchase twice" },
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
})

// The dialog scans in two phases: candidates_only (fast heuristic list) then
// the full AI call. Phase 1 echoes the same pairs verdict-stripped.
function mockScan(pairs: unknown[], ai = "ok", truncated = false) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/duplicates/scan")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { candidates_only?: boolean }
      if (body.candidates_only) {
        const heuristic = (pairs as Record<string, unknown>[]).map((p) => ({ ...p, verdict: null }))
        return new Response(JSON.stringify({ pairs: heuristic, ai: "pending", truncated }), { status: 200 })
      }
      return new Response(JSON.stringify({ pairs, ai, truncated }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url} ${init?.method}`)
  })
}

function renderDialog(onEntriesChanged = vi.fn()) {
  render(
    <DuplicateScanDialog
      bookId={BOOK_ID}
      accounts={ACCOUNTS}
      open
      onOpenChange={() => {}}
      onEntriesChanged={onEntriesChanged}
    />,
  )
  return onEntriesChanged
}

describe("<DuplicateScanDialog>", () => {
  it("scans on open and renders the pair with AI reason and account name", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02", source: "receipt" }))])
    renderDialog()
    expect(await screen.findByText(/same purchase twice/)).toBeInTheDocument()
    expect(screen.getAllByText("$50.00")).toHaveLength(2)
    expect(screen.getAllByText("Equipment").length).toBeGreaterThan(0)
  })

  it("links each entry with a document to the durable ?redirect=1 download route", async () => {
    const DOC_ID = "d0000000-0000-4000-8000-000000000001"
    mockScan([
      pair(
        scanEntry(ID_A, { source: "receipt", document_id: DOC_ID }),
        scanEntry(ID_B, { occurred_on: "2026-07-02" }), // no document → no link
      ),
    ])
    renderDialog()
    const link = await screen.findByRole("link", { name: /View receipt/ })
    expect(link).toHaveAttribute("href", `/api/admin/bookkeeping/documents/${DOC_ID}/download?redirect=1`)
    expect(link).toHaveAttribute("target", "_blank")
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })

  it("shows heuristic pairs with a progress strip and LOCKED actions while the AI verdict call is in flight", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/duplicates/scan")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { candidates_only?: boolean }
        if (body.candidates_only) {
          const p = pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }), { verdict: null })
          return new Response(JSON.stringify({ pairs: [p], ai: "pending", truncated: false }), { status: 200 })
        }
        return new Promise<Response>(() => {}) // AI leg never resolves in this test
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderDialog()
    expect(await screen.findByText(/AI is reviewing 1 candidate pair/)).toBeInTheDocument()
    expect(screen.getByText(/Heuristic match — same amount/)).toBeInTheDocument()
    for (const name of [/^Delete$/, /Not a duplicate/, /Scan again/]) {
      expect(screen.getAllByRole("button", { name })[0]).toBeDisabled()
    }
  })

  it("unlocks actions and swaps in verdicts when the AI phase completes", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))])
    renderDialog()
    expect(await screen.findByText(/same purchase twice/)).toBeInTheDocument()
    expect(screen.queryByText(/AI is reviewing/)).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^Delete$/ })[0]).toBeEnabled()
  })

  it("shows the empty state when the scan finds nothing", async () => {
    mockScan([], "skipped")
    renderDialog()
    expect(await screen.findByText(/No duplicate candidates found/)).toBeInTheDocument()
  })

  it("shows the heuristic-only banner when ai is unavailable", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B), { verdict: null })], "unavailable")
    renderDialog()
    expect(await screen.findByText(/AI unavailable/)).toBeInTheDocument()
  })

  it("delete removes EVERY pair containing that entry and refreshes the ledger", async () => {
    const p1 = pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))
    const p2 = pair(scanEntry(ID_A), scanEntry(ID_C, { occurred_on: "2026-07-03" }))
    mockScan([p1, p2])
    const onEntriesChanged = renderDialog()
    await screen.findAllByText(/same purchase twice/)

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes(`/entries/${ID_A}`) && init?.method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    // First Delete button belongs to entry A of the first pair; confirm step re-labels it.
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete$/ })[0])
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete/ }))

    await waitFor(() => {
      expect(screen.queryAllByText(/same purchase twice/)).toHaveLength(0)
    })
    expect(onEntriesChanged).toHaveBeenCalled()
  })

  it("surfaces the closed-period 409 as an error toast and keeps the pair", async () => {
    mockScan([pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))])
    renderDialog()
    await screen.findByText(/same purchase twice/)

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ error: "That month is closed." }), { status: 409 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete$/ })[0])
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That month is closed."))
    expect(screen.getByText(/same purchase twice/)).toBeInTheDocument()
  })

  it("'Not a duplicate' posts the pair fingerprint to the dismissals route and removes only that pair", async () => {
    const p1 = pair(scanEntry(ID_A), scanEntry(ID_B, { occurred_on: "2026-07-02" }))
    mockScan([p1])
    renderDialog()
    await screen.findByText(/same purchase twice/)

    let dismissBody: unknown = null
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/insights/dismissals") && init?.method === "POST") {
        dismissBody = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    fireEvent.click(screen.getByRole("button", { name: /Not a duplicate/ }))

    await waitFor(() => expect(screen.queryByText(/same purchase twice/)).not.toBeInTheDocument())
    expect(dismissBody).toEqual({ book_id: BOOK_ID, fingerprint: duplicatePairFingerprint(ID_A, ID_B) })
  })
})
