import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable recorder builder (house idiom — see bookkeeping-platform-income.test.ts):
// records every filter call; thenable so `await q` resolves.
const calls: { method: string; args: unknown[] }[] = []
function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "gte", "lte", "or", "is", "order", "range"]) {
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

import { listEntries } from "@/lib/db/bookkeeping"

const BOOK = "b0000000-0000-4000-8000-000000000001"
const ACCOUNT = "a0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  calls.length = 0
})

describe("listEntries account filter", () => {
  it("accountId='none' filters with .is('account_id', null) and never .eq on account_id", async () => {
    await listEntries({ bookId: BOOK, accountId: "none", page: 1, perPage: 50 })
    expect(calls.some((c) => c.method === "is" && c.args[0] === "account_id" && c.args[1] === null)).toBe(true)
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "account_id")).toBe(false)
  })
  it("a real accountId still filters with .eq — the sentinel does not swallow uuids", async () => {
    await listEntries({ bookId: BOOK, accountId: ACCOUNT, page: 1, perPage: 50 })
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "account_id" && c.args[1] === ACCOUNT)).toBe(true)
    expect(calls.some((c) => c.method === "is" && c.args[0] === "account_id")).toBe(false)
  })
})
