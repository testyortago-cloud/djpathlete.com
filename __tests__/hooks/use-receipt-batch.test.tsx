import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

const listeners = new Map<string, { cb: (snap: { val: () => unknown }) => void; err: (e: unknown) => void }>()
const offSpy = vi.fn()
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ path })),
  onValue: vi.fn(
    (r: { path: string }, cb: (snap: { val: () => unknown }) => void, err: (e: unknown) => void) => {
      listeners.set(r.path, { cb, err })
    },
  ),
  off: (...args: unknown[]) => offSpy(...args),
}))
const addJobSpy = vi.fn()
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: addJobSpy }) }))

import { useReceiptBatch } from "@/hooks/use-receipt-batch"
import type { BookkeepingAccount } from "@/types/database"

const accounts = [
  { id: "exp1", name: "Fuel", account_type: "expense", requires_business_purpose: false },
] as BookkeepingAccount[]

function makeFile(name: string, bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" })
}

function fireJob(jobId: string, payload: unknown) {
  const l = listeners.get(`ai_jobs/${jobId}`)
  if (!l) throw new Error(`no listener for ${jobId}`)
  act(() => l.cb({ val: () => payload }))
}

const fetchMock = vi.fn()

beforeEach(() => {
  listeners.clear()
  offSpy.mockClear()
  addJobSpy.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  URL.createObjectURL = vi.fn(() => "blob:mock") as never
  URL.revokeObjectURL = vi.fn() as never
})

function uploadOk(jobId: string, documentId: string, duplicateUploadHint: string | null = null) {
  return { ok: true, status: 202, json: async () => ({ jobId, documentId, duplicateUploadHint }) }
}

function renderBatch(onAllPosted = vi.fn()) {
  const hook = renderHook(() => useReceiptBatch({ bookId: "b1", accounts, onAllPosted }))
  return { hook, onAllPosted }
}

describe("addFiles", () => {
  it("dedupes by name+size and caps at 15, reporting dropped names", () => {
    const { hook } = renderBatch()
    const sixteen = Array.from({ length: 16 }, (_, i) => makeFile(`r${i}.jpg`))
    let dropped: string[] = []
    act(() => {
      dropped = hook.result.current.addFiles(sixteen).dropped
    })
    expect(hook.result.current.files).toHaveLength(15)
    expect(dropped).toEqual(["r15.jpg"])
    act(() => {
      dropped = hook.result.current.addFiles([makeFile("r0.jpg")]).dropped
    })
    expect(hook.result.current.files).toHaveLength(15) // duplicate silently skipped
  })
})

describe("startScan + review transition", () => {
  it("uploads sequentially, listens per job, and enters review sorted with dupes unticked", async () => {
    const { hook } = renderBatch()
    fetchMock
      .mockResolvedValueOnce(uploadOk("j1", "d1"))
      .mockResolvedValueOnce(uploadOk("j2", "d2", "2026-07-10T00:00:00Z"))
    act(() => {
      hook.result.current.addFiles([makeFile("late.jpg"), makeFile("early.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    expect(hook.result.current.phase).toBe("scanning")
    expect(addJobSpy).toHaveBeenCalledTimes(2)
    expect(addJobSpy.mock.calls[0][0].label).toBe("Receipt scan (1/2)")

    fireJob("j1", {
      status: "completed",
      result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-05", confidence: "high" },
    })
    fireJob("j2", {
      status: "completed",
      result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-01", confidence: "high" },
    })

    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
    const rows = hook.result.current.rows
    expect(rows.map((r) => r.counterparty)).toEqual(["HEB", "Chevron"]) // date-ascending
    expect(rows[0].included).toBe(false) // duplicateUploadHint → starts unticked
    expect(rows[1].included).toBe(true)
    expect(hook.result.current.busy).toBe(false)
  })

  it("keeps going past a failed upload and marks that row scan_failed", async () => {
    const { hook } = renderBatch()
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "Invalid file type" }) })
      .mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("bad.txt"), makeFile("good.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j2", { status: "completed", result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-01" } })
    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
    const failed = hook.result.current.rows.find((r) => r.fileName === "bad.txt")
    expect(failed?.status).toBe("scan_failed")
    expect(failed?.included).toBe(false)
  })

  it("falls back to select when nothing scanned and nothing stored", async () => {
    const { hook } = renderBatch()
    fetchMock.mockRejectedValueOnce(new Error("network"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    await waitFor(() => expect(hook.result.current.phase).toBe("select"))
    expect(hook.result.current.files).toHaveLength(1) // kept for retry
  })

  it("routes scan failure and listener error to scan_failed", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1")).mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j1", { status: "failed", error: "Model refused" })
    act(() => listeners.get("ai_jobs/j2")!.err(new Error("boom")))
    await waitFor(() => expect(hook.result.current.phase).toBe("review")) // d1/d2 stored → manual rows
    const [a, b] = hook.result.current.rows
    expect(a.status).toBe("scan_failed")
    expect(a.error).toBe("Model refused")
    expect(b.status).toBe("scan_failed")
    expect(b.error).toBe("Lost connection to scan updates")
  })
})

describe("cancelRemaining", () => {
  it("cancels in-flight jobs via the cancel route", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    await act(async () => {
      await hook.result.current.cancelRemaining()
    })
    const cancelCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/generate/cancel"))
    expect(cancelCall).toBeTruthy()
    expect(JSON.parse((cancelCall![1] as RequestInit).body as string)).toEqual({ jobId: "j1" })
    fireJob("j1", { status: "cancelled" })
    await waitFor(() => expect(hook.result.current.phase).toBe("review")) // d1 stored → manual row
    expect(hook.result.current.rows[0].status).toBe("cancelled")
  })
})

describe("postIncluded", () => {
  async function toReview(hook: ReturnType<typeof renderBatch>["hook"]) {
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1")).mockResolvedValueOnce(uploadOk("j2", "d2"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg"), makeFile("b.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    fireJob("j1", {
      status: "completed",
      result: { vendor: "Chevron", amount_cents: 4512, occurred_on: "2026-07-01", suggested_category: "Fuel" },
    })
    fireJob("j2", {
      status: "completed",
      result: { vendor: "HEB", amount_cents: 2000, occurred_on: "2026-07-02", suggested_category: "Fuel" },
    })
    await waitFor(() => expect(hook.result.current.phase).toBe("review"))
  }

  it("posts included rows sequentially and fires onAllPosted with count + cents", async () => {
    const { hook, onAllPosted } = renderBatch()
    await toReview(hook)
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/receipts/commit"))
    expect(commits).toHaveLength(2)
    const firstBody = JSON.parse((commits[0][1] as RequestInit).body as string)
    expect(firstBody.document_id).toBe("d1")
    expect(firstBody.amount_cents).toBe(4512)
    expect(firstBody.source_ref).toBe("receipt:d1")
    expect(firstBody.account_id).toBe("exp1")
    expect(hook.result.current.rows.every((r) => r.status === "posted")).toBe(true)
    expect(onAllPosted).toHaveBeenCalledWith(2, 6512)
    expect(hook.result.current.postedCount).toBe(2)
  })

  it("a 422 row fails inline without blocking others; retry completes and fires onAllPosted cumulatively", async () => {
    const { hook, onAllPosted } = renderBatch()
    await toReview(hook)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "business_purpose required for this category" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    expect(onAllPosted).not.toHaveBeenCalled()
    const failed = hook.result.current.rows.find((r) => r.status === "post_failed")
    expect(failed?.error).toBe("business_purpose required for this category")
    expect(hook.result.current.rows.filter((r) => r.status === "posted")).toHaveLength(1)
    expect(hook.result.current.postedCount).toBe(1)

    act(() => {
      hook.result.current.updateRow(failed!.clientId, { businessPurpose: "Team fuel" })
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    expect(onAllPosted).toHaveBeenCalledWith(2, 6512)
  })

  it("client-invalid rows fail without hitting the network", async () => {
    const { hook } = renderBatch()
    await toReview(hook)
    const target = hook.result.current.rows[0]
    act(() => {
      hook.result.current.updateRow(target.clientId, { amount: "" })
    })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ inserted: 1 }) })
    await act(async () => {
      await hook.result.current.postIncluded()
    })
    const commits = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/receipts/commit"))
    expect(commits).toHaveLength(1) // only the valid row
    expect(hook.result.current.rows.find((r) => r.clientId === target.clientId)?.error).toBe("Enter a valid amount")
  })
})

describe("reset", () => {
  it("detaches listeners and revokes thumbnails", async () => {
    const { hook } = renderBatch()
    fetchMock.mockResolvedValueOnce(uploadOk("j1", "d1"))
    act(() => {
      hook.result.current.addFiles([makeFile("a.jpg")])
    })
    await act(async () => {
      await hook.result.current.startScan()
    })
    act(() => {
      hook.result.current.reset()
    })
    expect(offSpy).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock")
    expect(hook.result.current.phase).toBe("select")
    expect(hook.result.current.files).toHaveLength(0)
    expect(hook.result.current.rows).toHaveLength(0)
  })
})
