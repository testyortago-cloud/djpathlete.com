import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const insertDismissalMock = vi.fn()
const deleteDismissalMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => recordAuditMock(...a) }))
vi.mock("@/lib/db/bookkeeping", () => ({
  insertDismissal: (...a: unknown[]) => insertDismissalMock(...a),
  deleteDismissal: (...a: unknown[]) => deleteDismissalMock(...a),
}))

import { POST, DELETE } from "@/app/api/admin/bookkeeping/insights/dismissals/route"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const FP = "vendor:adobe inc"

function req(method: string, body: unknown): Request {
  return new Request("http://x/api/admin/bookkeeping/insights/dismissals", {
    method,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset(); insertDismissalMock.mockReset(); deleteDismissalMock.mockReset(); recordAuditMock.mockReset()
  authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  insertDismissalMock.mockResolvedValue(undefined)
  deleteDismissalMock.mockResolvedValue(1)
})

describe("POST /api/admin/bookkeeping/insights/dismissals", () => {
  it("403s a non-admin and writes nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(403)
    expect(insertDismissalMock).not.toHaveBeenCalled()
  })
  it("400s a non-uuid book_id and an empty fingerprint", async () => {
    expect((await POST(req("POST", { book_id: "nope", fingerprint: FP }) as never)).status).toBe(400)
    expect((await POST(req("POST", { book_id: BOOK, fingerprint: "" }) as never)).status).toBe(400)
    expect(insertDismissalMock).not.toHaveBeenCalled()
  })
  it("inserts the dismissal stamped with the actor and audits finding_dismissed", async () => {
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(200)
    expect(insertDismissalMock).toHaveBeenCalledWith({ book_id: BOOK, fingerprint: FP, dismissed_by: "admin-1" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.finding_dismissed", category: "commerce" }),
    )
  })
  it("500s without leaking when the DAL throws", async () => {
    insertDismissalMock.mockRejectedValue(new Error("db boom"))
    const res = await POST(req("POST", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("boom")
  })

  // Batch form — the duplicate scan's "dismiss all N the AI cleared".
  it("dismisses a batch of fingerprints and audits EACH one separately", async () => {
    const fps = ["duplicate:a|b", "duplicate:c|d", "duplicate:e|f"]
    const res = await POST(req("POST", { book_id: BOOK, fingerprints: fps }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, dismissed: 3 })
    expect(insertDismissalMock).toHaveBeenCalledTimes(3)
    for (const fingerprint of fps) {
      expect(insertDismissalMock).toHaveBeenCalledWith({ book_id: BOOK, fingerprint, dismissed_by: "admin-1" })
    }
    // One audit row per fingerprint — a single row listing all three would not
    // be findable by the target filter on /admin/audit-logs.
    expect(recordAuditMock).toHaveBeenCalledTimes(3)
    expect(recordAuditMock.mock.calls.map((c) => (c[0] as { target: { id: string } }).target.id)).toEqual(fps)
  })

  it("400s when neither or both of fingerprint/fingerprints are given", async () => {
    expect((await POST(req("POST", { book_id: BOOK }) as never)).status).toBe(400)
    expect(
      (await POST(req("POST", { book_id: BOOK, fingerprint: FP, fingerprints: ["duplicate:a|b"] }) as never)).status,
    ).toBe(400)
    expect((await POST(req("POST", { book_id: BOOK, fingerprints: [] }) as never)).status).toBe(400)
    expect(insertDismissalMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/admin/bookkeeping/insights/dismissals", () => {
  it("deletes the dismissal and audits finding_undismissed", async () => {
    const res = await DELETE(req("DELETE", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(200)
    expect(deleteDismissalMock).toHaveBeenCalledWith(BOOK, FP)
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "bookkeeping.finding_undismissed" }),
    )
  })
  it("403s a non-admin", async () => {
    authMock.mockResolvedValue(null)
    const res = await DELETE(req("DELETE", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(403)
    expect(deleteDismissalMock).not.toHaveBeenCalled()
  })
  it("does NOT audit a restore that removed nothing", async () => {
    // The audit trail is the record of what CHANGED. A DELETE for a fingerprint
    // that was never dismissed (double-click, stale tab, replayed link) removes
    // no row — writing finding_undismissed anyway invents a restore that never
    // happened, and the row it names may still be dismissed.
    deleteDismissalMock.mockResolvedValue(0)
    const res = await DELETE(req("DELETE", { book_id: BOOK, fingerprint: FP }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: 0 })
    expect(recordAuditMock).not.toHaveBeenCalled()
  })
})
