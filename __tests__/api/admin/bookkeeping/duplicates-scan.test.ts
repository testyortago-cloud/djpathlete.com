import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const listEntriesForDuplicateScanMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()
const createGenerationLogMock = vi.fn()
const updateGenerationLogMock = vi.fn()
const callAgentMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntriesForDuplicateScan: (...a: unknown[]) => listEntriesForDuplicateScanMock(...a),
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

import { POST } from "@/app/api/admin/bookkeeping/duplicates/scan/route"
import { pairId } from "@/lib/bookkeeping/duplicate-scan"

const BOOK_ID = "b0000000-0000-4000-8000-000000000001"
const ID_A = "e0000000-0000-4000-8000-000000000001"
const ID_B = "e0000000-0000-4000-8000-000000000002"
const ID_C = "e0000000-0000-4000-8000-000000000003"
const ID_D = "e0000000-0000-4000-8000-000000000004"

function scanEntry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    occurred_on: "2026-07-01",
    amount_cents: 5000,
    direction: "expense",
    memo: "rogue fitness",
    counterparty: null,
    source: "statement_import",
    account_id: null,
    document_id: null,
    ...over,
  }
}

function req(body: unknown) {
  return new Request("http://test/api/admin/bookkeeping/duplicates/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  listDismissedFingerprintsMock.mockResolvedValue([])
  createGenerationLogMock.mockResolvedValue({ id: "log-1" })
  updateGenerationLogMock.mockResolvedValue({})
})

describe("POST /api/admin/bookkeeping/duplicates/scan", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ book_id: BOOK_ID }))
    expect(res.status).toBe(403)
  })

  it("400s a bad body", async () => {
    const res = await POST(req({ book_id: "not-a-uuid" }))
    expect(res.status).toBe(400)
  })

  it("short-circuits with ai:'skipped' and NO AI call when there are no candidates", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A, { amount_cents: 100 }),
      scanEntry(ID_B, { amount_cents: 200 }),
    ])
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ pairs: [], ai: "skipped", truncated: false })
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(createGenerationLogMock).not.toHaveBeenCalled()
  })

  it("candidates_only returns verdict-null heuristic pairs with NO AI call and NO log row", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    const res = await POST(req({ book_id: BOOK_ID, candidates_only: true }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ai).toBe("pending")
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].pair_id).toBe(pairId(ID_A, ID_B))
    expect(body.pairs[0].verdict).toBeNull()
    expect(callAgentMock).not.toHaveBeenCalled()
    expect(createGenerationLogMock).not.toHaveBeenCalled()
  })

  // Cleared pairs are RETURNED, not dropped. The close-readiness blocker counts
  // candidate pairs and is blind to AI verdicts, so dropping them here made the
  // pairs that hold a month hostage unreachable in the only UI that can dismiss
  // them (owner report, 2026-08-04).
  it("returns AI-confirmed, AI-cleared AND model-omitted pairs, each carrying its own verdict", async () => {
    // Three candidate pairs from two amount-groups: (A,B) confirmed, (C,D) cleared,
    // (A2,B2)… use a third group omitted by the model.
    const ID_E = "e0000000-0000-4000-8000-000000000005"
    const ID_F = "e0000000-0000-4000-8000-000000000006"
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02", source: "receipt" }),
      scanEntry(ID_C, { amount_cents: 7000 }),
      scanEntry(ID_D, { amount_cents: 7000, occurred_on: "2026-07-03" }),
      scanEntry(ID_E, { amount_cents: 9000 }),
      scanEntry(ID_F, { amount_cents: 9000, occurred_on: "2026-07-04" }),
    ])
    callAgentMock.mockResolvedValue({
      content: {
        verdicts: [
          { pair_id: pairId(ID_A, ID_B), is_duplicate: true, confidence: "high", reason: "same memo, day apart, receipt vs statement" },
          { pair_id: pairId(ID_C, ID_D), is_duplicate: false, confidence: "medium", reason: "recurring subscription" },
          { pair_id: "unknown|pair", is_duplicate: true, confidence: "low", reason: "ignore me" },
        ],
      },
      tokens_used: 100,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    })
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(body.ai).toBe("ok")
    expect(body.pairs).toHaveLength(3)
    const confirmed = body.pairs.find((p: { pair_id: string }) => p.pair_id === pairId(ID_A, ID_B))
    const cleared = body.pairs.find((p: { pair_id: string }) => p.pair_id === pairId(ID_C, ID_D))
    const omitted = body.pairs.find((p: { pair_id: string }) => p.pair_id === pairId(ID_E, ID_F))
    expect(confirmed.verdict).toEqual({ is_duplicate: true, confidence: "high", reason: "same memo, day apart, receipt vs statement" })
    expect(cleared.verdict).toEqual({ is_duplicate: false, confidence: "medium", reason: "recurring subscription" })
    expect(omitted.verdict).toBeNull()
    // flagged = needs a human (confirmed + omitted); cleared is counted apart.
    expect(updateGenerationLogMock).toHaveBeenCalledWith(
      "log-1",
      expect.objectContaining({
        status: "completed",
        output_summary: { candidate_pairs: 3, flagged: 2, cleared: 1 },
      }),
    )
  })

  it("passes dismissed fingerprints into candidate generation (dismissed pair never reaches the AI)", async () => {
    const { duplicatePairFingerprint } = await import("@/lib/bookkeeping/finding-fingerprint")
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    listDismissedFingerprintsMock.mockResolvedValue([duplicatePairFingerprint(ID_A, ID_B)])
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(body).toEqual({ pairs: [], ai: "skipped", truncated: false })
    expect(callAgentMock).not.toHaveBeenCalled()
  })

  it("returns ai:'unavailable' with ALL candidate pairs (verdict null) when the AI leg throws", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    callAgentMock.mockRejectedValue(new Error("model down"))
    const res = await POST(req({ book_id: BOOK_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ai).toBe("unavailable")
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].verdict).toBeNull()
    expect(updateGenerationLogMock).toHaveBeenCalledWith("log-1", expect.objectContaining({ status: "failed" }))
  })

  it("never sends a generation_trigger key to ai_generation_log", async () => {
    listEntriesForDuplicateScanMock.mockResolvedValue([
      scanEntry(ID_A),
      scanEntry(ID_B, { occurred_on: "2026-07-02" }),
    ])
    callAgentMock.mockResolvedValue({ content: { verdicts: [] }, tokens_used: 1, cache_creation_tokens: 0, cache_read_tokens: 0 })
    await POST(req({ book_id: BOOK_ID }))
    expect(createGenerationLogMock).toHaveBeenCalledTimes(1)
    const arg = createGenerationLogMock.mock.calls[0][0] as Record<string, unknown>
    expect("generation_trigger" in arg).toBe(false)
    expect((arg.input_params as Record<string, unknown>).feature).toBe("bookkeeping_duplicate_scan")
  })
})
