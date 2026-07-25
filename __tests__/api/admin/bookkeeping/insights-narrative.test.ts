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
const GAP_ENTRY_ID = "e0000000-0000-4000-8000-000000000001"

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
  loadInsightsBundleMock.mockResolvedValue({ books: [BOOK], accounts: [ACCOUNT], entries: [GAP_ENTRY] })
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

  it("a dismissed finding is filtered BEFORE compaction — the AI never sees it", async () => {
    listDismissedFingerprintsMock.mockResolvedValue([`substantiation_gap:${GAP_ENTRY_ID}`])
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].substantiation_gap_count).toBe(0)
    expect(userMessage.books[0].substantiation_gap_cents).toBe(0)
  })

  it("an undismissed run keeps the gap in the compacted summary (discriminator pair)", async () => {
    await POST(req({ from: "2026-01-01", to: "2026-06-30" }) as never)
    const userMessage = JSON.parse(callAgentMock.mock.calls[0][1] as string)
    expect(userMessage.books[0].substantiation_gap_count).toBe(1)
    expect(userMessage.books[0].substantiation_gap_cents).toBe(4200)
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
