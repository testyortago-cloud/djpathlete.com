import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable recorder builder (house idiom — see bookkeeping-entries-filters.test.ts):
// records every filter call; thenable so `await q` resolves.
const calls: { method: string; args: unknown[] }[] = []
function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "like", "or", "is", "order", "range", "update"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args })
      return builder
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable protocol
  ;(builder as any).then = (onFulfilled?: any, onRejected?: any) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected)
  return builder
}
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({ from: () => makeBuilder() }) }))

import {
  countPendingEmailReceiptDocuments,
  ignoreEmailReceiptDocument,
  listExternalRefsWithPrefix,
  listPendingEmailReceiptDocuments,
  rehomeEmailReceiptDocument,
} from "@/lib/db/bookkeeping"

beforeEach(() => {
  calls.length = 0
})

const has = (method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && args.every((a, i) => c.args[i] === a))

describe("listPendingEmailReceiptDocuments filter chain", () => {
  it("narrows to receipt documents polled from Gmail", async () => {
    await listPendingEmailReceiptDocuments()
    expect(has("eq", "kind", "receipt")).toBe(true)
    // LIKE, not eq — external_ref is 'gmail:<messageId>:<attachmentIndex>'.
    expect(has("like", "external_ref", "gmail:%")).toBe(true)
    expect(has("eq", "external_ref")).toBe(false)
  })

  it("pending means posted_count IS NULL only — a written 0 is 'commit ran, entry already existed'", async () => {
    await listPendingEmailReceiptDocuments()
    // posted_count has no default and is written ONLY by linkDocumentBatch, so
    // for these documents 0 can only mean the commit route ran and
    // insertReceiptEntry deduped (inserted: 0). Matching 0 would pin such a
    // document in the queue forever with no way to clear it.
    expect(has("is", "posted_count", null)).toBe(true)
    expect(calls.some((c) => c.method === "or" && String(c.args[0]).includes("posted_count"))).toBe(false)
    expect(has("eq", "posted_count", 0)).toBe(false)
  })

  it("orders newest first and reads through the paginator", async () => {
    await listPendingEmailReceiptDocuments()
    expect(has("order", "created_at")).toBe(true)
    expect(has("range", 0, 999)).toBe(true)
  })

  // A .range()-paginated read whose ORDER BY is not a total order can hand the
  // same row back on two pages while another row is never returned at all.
  // created_at is NOT unique here — one poller run inserts several receipt
  // documents inside the same millisecond.
  it("breaks created_at ties on id so the paginated sort is a TOTAL order", async () => {
    await listPendingEmailReceiptDocuments()
    const orders = calls.filter((c) => c.method === "order").map((c) => c.args[0])
    expect(orders).toEqual(["created_at", "id"])
  })
})

describe("listExternalRefsWithPrefix", () => {
  it("orders by the UNIQUE external_ref before paginating", async () => {
    await listExternalRefsWithPrefix("gmail:m1:")
    expect(has("like", "external_ref", "gmail:m1:%")).toBe(true)
    // Without an ORDER BY, PostgREST guarantees nothing about which rows land
    // in which .range() window — a ref missed at a page boundary reads as
    // "not yet ingested" and the poller re-ingests the attachment (duplicate
    // document + a second vision spend). external_ref is UNIQUE (00193), so
    // ordering on it alone is already a total order.
    const orders = calls.filter((c) => c.method === "order")
    expect(orders.length).toBeGreaterThan(0)
    expect(orders[0].args[0]).toBe("external_ref")
    expect(has("range", 0, 999)).toBe(true)
  })
})

describe("countPendingEmailReceiptDocuments", () => {
  it("uses the SAME three pending filters as the list, as a head-only count", async () => {
    await countPendingEmailReceiptDocuments()
    expect(has("eq", "kind", "receipt")).toBe(true)
    expect(has("like", "external_ref", "gmail:%")).toBe(true)
    expect(has("is", "posted_count", null)).toBe(true)
    const select = calls.find((c) => c.method === "select")
    expect(select?.args[1]).toMatchObject({ count: "exact", head: true })
    // No row fetch — a badge must not pull the whole queue.
    expect(calls.some((c) => c.method === "range")).toBe(false)
  })
})

describe("ignoreEmailReceiptDocument / rehomeEmailReceiptDocument guards", () => {
  it("ignore writes posted_count 0 ONLY to a gmail-ref, never-posted document", async () => {
    await ignoreEmailReceiptDocument("d1")
    const update = calls.find((c) => c.method === "update")
    expect(update?.args[0]).toMatchObject({ posted_count: 0 })
    expect(has("eq", "id", "d1")).toBe(true)
    expect(has("like", "external_ref", "gmail:%")).toBe(true)
    expect(has("is", "posted_count", null)).toBe(true)
  })

  it("rehome moves book_id under the same guard — photo docs and posted docs can never move", async () => {
    await rehomeEmailReceiptDocument("d1", "b2")
    const update = calls.find((c) => c.method === "update")
    expect(update?.args[0]).toMatchObject({ book_id: "b2" })
    expect(has("eq", "id", "d1")).toBe(true)
    expect(has("like", "external_ref", "gmail:%")).toBe(true)
    expect(has("is", "posted_count", null)).toBe(true)
  })
})
