import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable recorder builder (house idiom — see bookkeeping-entries-filters.test.ts):
// records every filter call; thenable so `await q` resolves.
const calls: { method: string; args: unknown[] }[] = []
function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "like", "or", "is", "order", "range"]) {
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

import { listPendingEmailReceiptDocuments } from "@/lib/db/bookkeeping"

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
})
