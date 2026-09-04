// @vitest-environment node
//
// findContactWithBusinessByIdentifiers is the one contact lookup in this repo
// with NO business predicate, on purpose: its caller is the Stripe webhook,
// which has no tenant in scope, and the contact row it finds is what SUPPLIES
// the tenant to every consequence downstream (Task 11). This file pins that
// resolution logic directly, including the "two businesses share an email"
// tie-break -- the case that DOES need a real, order-aware mock rather than a
// vi.fn() stub, because the correctness of the tie-break IS the ordering.
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContactRow = {
  id: string
  business_id: string
  created_at: string
  email?: string
  user_id?: string
}

let rows: ContactRow[] = []

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "contacts") throw new Error(`unmocked table: ${table}`)
      const filters: Array<[string, unknown]> = []
      let ascending = true
      const api: any = {
        select() {
          return api
        },
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return api
        },
        order(_col: string, opts: { ascending: boolean }) {
          ascending = opts.ascending
          return api
        },
        then(resolve: any) {
          const matched = rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
          // Real sort, not a no-op: mutating `ascending` (e.g. the tie-break
          // ordering flipping true -> false) must change which row lands at
          // index 0, exactly like a real ORDER BY would.
          const sorted = [...matched].sort((a, b) =>
            ascending ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
          )
          return resolve({ data: sorted, error: null })
        },
      }
      return api
    },
  }),
}))

import { findContactWithBusinessByIdentifiers } from "@/lib/db/contacts"

beforeEach(() => {
  rows = []
})

describe("findContactWithBusinessByIdentifiers", () => {
  it("resolves by userId when given, returning the id AND its business_id", async () => {
    rows = [{ id: "c1", business_id: "bbb", user_id: "u1", created_at: "2026-01-01T00:00:00Z" }]
    const result = await findContactWithBusinessByIdentifiers({ userId: "u1" })
    expect(result).toEqual({ id: "c1", businessId: "bbb" })
  })

  it("falls back to email when userId is given but matches nothing", async () => {
    rows = [{ id: "c2", business_id: "bbb", email: "lead@example.com", created_at: "2026-01-01T00:00:00Z" }]
    const result = await findContactWithBusinessByIdentifiers({
      userId: "does-not-exist",
      email: "lead@example.com",
    })
    expect(result).toEqual({ id: "c2", businessId: "bbb" })
  })

  it("normalises email casing/whitespace before matching", async () => {
    rows = [{ id: "c3", business_id: "bbb", email: "lead@example.com", created_at: "2026-01-01T00:00:00Z" }]
    const result = await findContactWithBusinessByIdentifiers({ email: "  Lead@Example.com  " })
    expect(result).toEqual({ id: "c3", businessId: "bbb" })
  })

  it("returns null when nothing matches either identifier", async () => {
    rows = [{ id: "c4", business_id: "bbb", email: "someone-else@example.com", created_at: "2026-01-01T00:00:00Z" }]
    const result = await findContactWithBusinessByIdentifiers({ email: "nobody@example.com" })
    expect(result).toBeNull()
  })

  it("returns null when given neither identifier", async () => {
    const result = await findContactWithBusinessByIdentifiers({})
    expect(result).toBeNull()
  })

  // The known ambiguity, stated rather than hidden: two businesses can each
  // hold a contact with the same email. Deterministic resolution (oldest
  // wins) plus a warning, not silence.
  it("picks the OLDEST row and warns when two businesses hold a contact with the same email", async () => {
    rows = [
      { id: "c-old", business_id: "aaa", email: "shared@example.com", created_at: "2026-01-01T00:00:00Z" },
      { id: "c-new", business_id: "bbb", email: "shared@example.com", created_at: "2026-06-01T00:00:00Z" },
    ]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await findContactWithBusinessByIdentifiers({ email: "shared@example.com" })
    expect(result).toEqual({ id: "c-old", businessId: "aaa" })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("does not warn when only one contact matches", async () => {
    rows = [{ id: "c5", business_id: "bbb", email: "solo@example.com", created_at: "2026-01-01T00:00:00Z" }]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await findContactWithBusinessByIdentifiers({ email: "solo@example.com" })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("the same tie-break (oldest wins) applies to a shared userId, not only email", async () => {
    rows = [
      { id: "c-old-u", business_id: "aaa", user_id: "u-shared", created_at: "2026-01-01T00:00:00Z" },
      { id: "c-new-u", business_id: "bbb", user_id: "u-shared", created_at: "2026-06-01T00:00:00Z" },
    ]
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await findContactWithBusinessByIdentifiers({ userId: "u-shared" })
    expect(result).toEqual({ id: "c-old-u", businessId: "aaa" })
    warn.mockRestore()
  })
})
