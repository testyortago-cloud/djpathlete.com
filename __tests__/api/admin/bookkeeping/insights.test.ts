import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const loadInsightsBundleMock = vi.fn()
const getSettingMock = vi.fn()
const listEntriesForInsightsMock = vi.fn()
const listDismissedFingerprintsMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/bookkeeping/insight-data", () => ({
  loadInsightsBundle: (...a: unknown[]) => loadInsightsBundleMock(...a),
}))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: (...a: unknown[]) => getSettingMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  listEntriesForInsights: (...a: unknown[]) => listEntriesForInsightsMock(...a),
  listDismissedFingerprints: (...a: unknown[]) => listDismissedFingerprintsMock(...a),
}))

import { GET } from "@/app/api/admin/bookkeeping/insights/route"

const BOOK = {
  id: "b0000000-0000-4000-8000-000000000001",
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

beforeEach(() => {
  authMock.mockReset(); loadInsightsBundleMock.mockReset(); getSettingMock.mockReset()
  listEntriesForInsightsMock.mockReset(); listDismissedFingerprintsMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  loadInsightsBundleMock.mockResolvedValue({ books: [BOOK], accounts: [], entries: [] })
  getSettingMock.mockResolvedValue(null)
  listEntriesForInsightsMock.mockResolvedValue([])
  listDismissedFingerprintsMock.mockResolvedValue(["vendor:adobe inc"])
})

describe("GET /api/admin/bookkeeping/insights", () => {
  it("returns each book's dismissed_fingerprints from the dismissals table", async () => {
    const res = await GET(new Request("http://x/api?from=2026-01-01&to=2026-06-30") as never)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.books[0].dismissed_fingerprints).toEqual(["vendor:adobe inc"])
    expect(listDismissedFingerprintsMock).toHaveBeenCalledWith(BOOK.id)
  })
  it("403s a non-admin before any read", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await GET(new Request("http://x/api?from=2026-01-01&to=2026-06-30") as never)
    expect(res.status).toBe(403)
    expect(loadInsightsBundleMock).not.toHaveBeenCalled()
  })
})
