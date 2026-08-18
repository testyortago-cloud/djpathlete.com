// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: { rows: any[] } = { rows: [] }

// The implementation runs two separate .eq() queries (one for email, one for
// phone) instead of a single .or() filter, so this mock filters state.rows by
// whatever .eq() calls were chained onto a given `.from("contacts")` call,
// rather than returning every row regardless of the query.
function makeTable(table: string) {
  const filters: Record<string, any> = {}

  function filterRows() {
    if (table !== "contacts") return state.rows
    return state.rows.filter((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value),
    )
  }

  const api: any = {
    select() {
      return api
    },
    eq(field: string, value: any) {
      filters[field] = value
      return api
    },
    or() {
      return api
    },
    order() {
      return api
    },
    limit() {
      return api
    },
    async maybeSingle() {
      const rows = filterRows()
      return { data: rows[0] ?? null, error: null }
    },
    async then(res: any) {
      return res({ data: filterRows(), error: null })
    },
    insert(payload: any) {
      const row = { id: `new-${state.rows.length + 1}`, created_at: "2026-08-18T00:00:00Z", ...payload }
      if (table === "contacts") state.rows.push(row)
      return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
    },
    update(patch: any) {
      return {
        eq: () => ({ select: () => ({ single: async () => ({ data: { ...state.rows[0], ...patch }, error: null }) }) }),
      }
    },
    delete() {
      return { eq: async () => ({ error: null }) }
    },
  }
  return api
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => makeTable(table),
  }),
}))

// Wrap the real decideMerge in a spy so the de-duplication test can assert on
// the candidate array it was actually called with, without changing its
// behaviour.
vi.mock("@/lib/lead-engine/merge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-engine/merge")>()
  return {
    ...actual,
    decideMerge: vi.fn(actual.decideMerge),
  }
})

import { recordContactEvent } from "@/lib/db/contacts"
import { decideMerge } from "@/lib/lead-engine/merge"

beforeEach(() => {
  state.rows = []
  vi.clearAllMocks()
})

describe("recordContactEvent", () => {
  it("creates a contact when nothing matches", async () => {
    const out = await recordContactEvent({
      email: "New@Example.com",
      phone: "617-650-4548",
      name: "Marissa",
      source: "funnel_form",
    })
    expect(out.created).toBe(true)
    expect(out.merged).toBe(false)
    expect(state.rows[0].email).toBe("new@example.com")
    expect(state.rows[0].phone_e164).toBe("+16176504548")
  })

  it("rejects an event carrying neither identifier", async () => {
    await expect(
      recordContactEvent({ email: null, phone: null, source: "funnel_form" }),
    ).rejects.toThrow(/identifier/i)
  })

  it("stores the business id on the contact", async () => {
    await recordContactEvent({ email: "a@b.com", source: "newsletter" })
    expect(state.rows[0].business_id).toBe("00000000-0000-0000-0000-000000000001")
  })

  it("de-duplicates a contact matched by both the email and the phone query", async () => {
    state.rows.push({
      id: "existing-1",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "dup@example.com",
      phone_e164: "+16176504548",
      created_at: "2020-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "dup@example.com",
      phone: "617-650-4548",
      source: "funnel_form",
    })

    expect(out.created).toBe(false)
    expect(out.merged).toBe(false)
    expect(out.contactId).toBe("existing-1")

    expect(decideMerge).toHaveBeenCalledTimes(1)
    const candidatesArg = (decideMerge as any).mock.calls[0][0]
    expect(candidatesArg).toHaveLength(1)
    expect(candidatesArg[0].id).toBe("existing-1")
  })
})
