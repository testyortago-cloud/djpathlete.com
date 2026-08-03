import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getSettingMock = vi.fn()
const setSettingMock = vi.fn()
const getPlatformConnectionMock = vi.fn()
const latestCronRunMock = vi.fn()
const hasStatementImportEntriesMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/system-settings", () => ({
  getSetting: (...a: unknown[]) => getSettingMock(...a),
  setSetting: (...a: unknown[]) => setSettingMock(...a),
}))
vi.mock("@/lib/db/platform-connections", () => ({ getPlatformConnection: (...a: unknown[]) => getPlatformConnectionMock(...a) }))
vi.mock("@/lib/db/cron-runs", () => ({ latestCronRun: (...a: unknown[]) => latestCronRunMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({ hasStatementImportEntries: (...a: unknown[]) => hasStatementImportEntriesMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))

import { GET, PATCH } from "@/app/api/admin/bookkeeping/setup-status/route"

function patchReq(body: unknown) {
  return new Request("http://test/api/admin/bookkeeping/setup-status", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  // getSetting(key, fallback) → fallback-shaped defaults; individual tests override.
  getSettingMock.mockImplementation(async (_key: string, fallback: unknown) => fallback)
  getPlatformConnectionMock.mockResolvedValue(null)
  latestCronRunMock.mockResolvedValue(null)
  hasStatementImportEntriesMock.mockResolvedValue(false)
  setSettingMock.mockResolvedValue({})
})

describe("GET /api/admin/bookkeeping/setup-status", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    expect((await GET()).status).toBe(403)
  })
  it("returns 11 items with counts from real evaluation (unconfigured system → 0 done)", async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(11)
    expect(body.totalCount).toBe(11)
    expect(body.doneCount).toBe(0)
    expect(body.tourCompletedAt).toBeNull()
  })
  it("a connected gmail account flips gmail_connected to done", async () => {
    getPlatformConnectionMock.mockResolvedValue({ id: "pc1" })
    const body = await (await GET()).json()
    expect(body.items.find((i: { key: string }) => i.key === "gmail_connected").status).toBe("done")
  })
})

describe("PATCH /api/admin/bookkeeping/setup-status", () => {
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue(null)
    expect((await PATCH(patchReq({ key: "categories_reviewed", checked: true }))).status).toBe(403)
  })
  it("adds a manual key to the stored array, audits, and is idempotent", async () => {
    getSettingMock.mockImplementation(async (key: string, fallback: unknown) =>
      key === "bookkeeping_setup_manual_checks" ? ["categories_reviewed"] : fallback)
    const res = await PATCH(patchReq({ key: "categories_reviewed", checked: true }))
    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledWith("bookkeeping_setup_manual_checks", ["categories_reviewed"], "admin-1")
    expect(recordAuditMock).toHaveBeenCalled()
  })
  it("unchecking removes the key", async () => {
    getSettingMock.mockImplementation(async (key: string, fallback: unknown) =>
      key === "bookkeeping_setup_manual_checks" ? ["categories_reviewed"] : fallback)
    await PATCH(patchReq({ key: "categories_reviewed", checked: false }))
    expect(setSettingMock).toHaveBeenCalledWith("bookkeeping_setup_manual_checks", [], "admin-1")
  })
  it("rejects an unknown manual key with 400", async () => {
    expect((await PATCH(patchReq({ key: "not_a_key", checked: true }))).status).toBe(400)
  })
  it("tour_completed stamps an ISO timestamp", async () => {
    const res = await PATCH(patchReq({ tour_completed: true }))
    expect(res.status).toBe(200)
    const [key, value] = setSettingMock.mock.calls[0]
    expect(key).toBe("bookkeeping_tour_completed_at")
    expect(typeof value).toBe("string")
  })
})
