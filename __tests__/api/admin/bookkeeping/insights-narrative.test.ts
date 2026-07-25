import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const authMock = vi.fn()
const loadInsightsBundleMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()
const createGenerationLogMock = vi.fn()
const updateGenerationLogMock = vi.fn()
const callAgentMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({
  loadInsightsBundle: (...a: unknown[]) => loadInsightsBundleMock(...a),
}))
vi.mock("@/lib/db/bookkeeping", () => ({
  listDismissedFingerprints: (...a: unknown[]) => listDismissedFingerprintsMock(...a),
}))
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: (...a: unknown[]) => createGenerationLogMock(...a),
  updateGenerationLog: (...a: unknown[]) => updateGenerationLogMock(...a),
}))
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...a: unknown[]) => callAgentMock(...a),
  MODEL_SONNET: "sonnet",
}))

import { POST } from "@/app/api/admin/bookkeeping/insights/narrative/route"

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001"
const SOFTWARE_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000002"
const INCOME_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000003"
const GAP_ENTRY_ID = "e0000000-0000-4000-8000-000000000001"
const UNCAT_ENTRY_ID = "e0000000-0000-4000-8000-000000000002"
const VENDOR_KEY = "adobe"

const BOOK = {
  id: BOOK_ID,
  name: "Darren — DJP Athlete",
  book_kind: "business",
  owner_label: "Darren",
  is_primary: true,
  currency: "usd",
  sort_order: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}
// Purpose-required account + blank-purpose entry ⇒ ONE real substantiation gap
// out of the REAL deductionFindings run (finders are not mocked).
const ACCOUNT = {
  id: ACCOUNT_ID,
  book_id: BOOK_ID,
  name: "Meals (business purpose)",
  account_type: "expense",
  service_line: null,
  tax_category: null,
  sort_order: 0,
  is_deductible_candidate: true,
  requires_business_purpose: true,
  archived_at: null,
}
const GAP_ENTRY = {
  id: GAP_ENTRY_ID,
  book_id: BOOK_ID,
  account_id: ACCOUNT_ID,
  direction: "expense",
  amount_cents: 4200,
  occurred_on: "2026-03-01",
  counterparty: "Chipotle",
  memo: null,
  source: "manual",
  business_purpose: null,
  document_id: "d0000000-0000-4000-8000-000000000001",
}
// Non-watch, purpose-free expense account: carries the recurring vendor without
// adding a second watchlist row or a second substantiation gap.
const SOFTWARE_ACCOUNT = {
  id: SOFTWARE_ACCOUNT_ID,
  book_id: BOOK_ID,
  name: "Software",
  account_type: "expense",
  service_line: null,
  tax_category: null,
  sort_order: 1,
  is_deductible_candidate: false,
  requires_business_purpose: false,
  archived_at: null,
}
// Service-lined INCOME account ⇒ serviceLineProfit emits one real row whose net
// excludes the (untagged, therefore shared) $72.00 of expenses below.
const INCOME_ACCOUNT = {
  id: INCOME_ACCOUNT_ID,
  book_id: BOOK_ID,
  name: "Performance training income",
  account_type: "income",
  service_line: "performance_training",
  tax_category: null,
  sort_order: 2,
  is_deductible_candidate: false,
  requires_business_purpose: false,
  archived_at: null,
}
const INCOME_ENTRY = {
  id: "e0000000-0000-4000-8000-000000000003",
  book_id: BOOK_ID,
  account_id: INCOME_ACCOUNT_ID,
  direction: "income",
  amount_cents: 100_000,
  occurred_on: "2026-02-10",
  counterparty: "Client A",
  memo: null,
  source: "manual",
  business_purpose: null,
  document_id: null,
}
// Three equal monthly charges (gaps 31 / 28 ⇒ median 30 days) ⇒ ONE real
// recurring vendor out of the REAL vendorSweep run.
const VENDOR_ENTRIES = ["2026-01-05", "2026-02-05", "2026-03-05"].map((day, i) => ({
  id: `e0000000-0000-4000-8000-00000000001${i}`,
  book_id: BOOK_ID,
  account_id: SOFTWARE_ACCOUNT_ID,
  direction: "expense",
  amount_cents: 1000,
  occurred_on: day,
  counterparty: "Adobe",
  memo: null,
  source: "manual",
  business_purpose: null,
  document_id: null,
}))
// Expense with no account ⇒ ONE real uncategorized entry; a single charge, so it
// can never be picked up as a recurring vendor.
const UNCAT_ENTRY = {
  id: UNCAT_ENTRY_ID,
  book_id: BOOK_ID,
  account_id: null,
  direction: "expense",
  amount_cents: 2500,
  occurred_on: "2026-04-02",
  counterparty: "Costco",
  memo: null,
  source: "manual",
  business_purpose: null,
  document_id: null,
}

function req(body: unknown): Request {
  return new Request("http://x/api/admin/bookkeeping/insights/narrative", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset()
  loadInsightsBundleMock.mockReset()
  listDismissedFingerprintsMock.mockReset()
  createGenerationLogMock.mockReset()
  updateGenerationLogMock.mockReset()
  callAgentMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  loadInsightsBundleMock.mockResolvedValue({
    books: [BOOK],
    accounts: [ACCOUNT, SOFTWARE_ACCOUNT, INCOME_ACCOUNT],
    entries: [GAP_ENTRY, INCOME_ENTRY, ...VENDOR_ENTRIES, UNCAT_ENTRY],
  })
  listDismissedFingerprintsMock.mockResolvedValue([])
  createGenerationLogMock.mockResolvedValue({ id: "log-1" })
  updateGenerationLogMock.mockResolvedValue({ id: "log-1" })
  callAgentMock.mockResolvedValue({
    content: { observations: ["One.", "Two.", "Three."] },
    tokens_used: 500,
    cache_creation_tokens: null,
    cache_read_tokens: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/admin/bookkeeping/insights/narrative", () => {
  it("403s a non-admin before any read or spend", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    expect(res.status).toBe(403)
    expect(loadInsightsBundleMock).not.toHaveBeenCalled()
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("returns observations and finalizes the generation log as completed", async () => {
    const res = await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.observations).toEqual(["One.", "Two.", "Three."])
    expect(json.fallback).toBeNull()
    expect(createGenerationLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", model_used: "sonnet" }),
    )
    expect(updateGenerationLogMock).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({ status: "completed", tokens_used: 500 }),
    )
    const options = callAgentMock.mock.calls[0][3]
    expect(options).toMatchObject({ model: "sonnet", maxTokens: 1200 })
  })

  // The live ai_generation_log has NO generation_trigger column (00034 was never
  // applied to this project); PostgREST rejects an unknown body key outright, so
  // sending it would kill the AI leg on every request in production.
  it("never sends a generation_trigger key on the log insert", async () => {
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const payload = createGenerationLogMock.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload)).not.toContain("generation_trigger")
    expect(payload.input_params).toMatchObject({ feature: "bookkeeping_insights_narrative" })
  })

  it("a dismissed finding is filtered BEFORE compaction — the AI never sees it", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`substantiation_gap:${GAP_ENTRY_ID}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].substantiation_gap_count).toBe(0)
    expect(userMessage.books[0].substantiation_gap_cents).toBe(0)
  })

  it("a dismissed watchlist account is filtered BEFORE compaction", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`watchlist:${ACCOUNT_ID}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].watchlist).toEqual([])
  })

  it("a dismissed uncategorized entry is filtered BEFORE compaction", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`uncategorized:${UNCAT_ENTRY_ID}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].uncategorized_count).toBe(0)
    expect(userMessage.books[0].uncategorized_cents).toBe(0)
  })

  it("a dismissed recurring vendor is filtered BEFORE compaction", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`vendor:${VENDOR_KEY}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].recurring_vendors).toEqual([])
  })

  it("an undismissed run keeps every finder's rows in the compacted summary (discriminator pairs)", async () => {
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    const book = userMessage.books[0]
    expect(book.substantiation_gap_count).toBe(1)
    expect(book.substantiation_gap_cents).toBe(4200)
    expect(book.watchlist).toEqual([{ name: "Meals (business purpose)", total_cents: 4200, entries: 1 }])
    expect(book.uncategorized_count).toBe(1)
    expect(book.uncategorized_cents).toBe(2500)
    expect(book.recurring_vendors).toEqual([{ name: "Adobe", cadence: "monthly", annualized_cents: 12_000 }])
  })

  // serviceLineProfit's per-row net subtracts DIRECT costs only — shared/overhead
  // sits outside it. The payload must not hand the model a bare "net".
  it("labels the per-line net as before-shared-costs and warns the model in the prompt", async () => {
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const systemPrompt = callAgentMock.mock.calls[0][0] as string
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    const profit = userMessage.books[0].profit
    expect(profit.shared_cost_cents).toBe(7200)
    expect(profit.rows).toEqual([
      { label: "Performance Training", income_cents: 100_000, net_before_shared_costs_cents: 100_000 },
    ])
    expect(JSON.stringify(profit)).not.toContain("net_estimate_cents")
    expect(systemPrompt).toContain("net_before_shared_costs_cents")
    expect(systemPrompt).toContain("shared_cost_cents")
  })

  it("AI timeout falls back honestly: 200, observations null, log failed", async () => {
    vi.useFakeTimers()
    callAgentMock.mockReturnValue(new Promise(() => {})) // never settles → withTimeout(20s) fires
    const pending = POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    await vi.advanceTimersByTimeAsync(20_001)
    const res = await pending
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.observations).toBeNull()
    expect(json.fallback).toBe("AI summary unavailable — the live numbers above are unaffected.")
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "failed" }))
  })

  it("400s an invalid window without spending", async () => {
    const res = await POST(req({ from: "2026-06-30", to: "2026-01-01" }) as never)
    expect(res.status).toBe(400)
    expect(callAgentMock).not.toHaveBeenCalled()
  })
})
