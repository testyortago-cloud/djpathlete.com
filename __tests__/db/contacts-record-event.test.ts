// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: {
  rows: any[]
  merges: any[]
  errors: { contactsUpdate?: any; timelineInsert?: any }
} = { rows: [], merges: [], errors: {} }

function collectionFor(table: string): any[] {
  if (table === "contacts") return state.rows
  if (table === "contact_merges") return state.merges
  return []
}

// The implementation runs two separate .eq() queries (one for email, one for
// phone) instead of a single .or() filter, so this mock filters a table's
// backing collection by whatever .eq() calls were actually chained onto a
// given `.from(table)` call (AND semantics, matching real PostgREST chaining)
// rather than returning every row regardless of the query. It also supports
// injected write errors so error-checking paths can be exercised directly.
function makeTable(table: string) {
  const filters: Record<string, any> = {}

  function filterRows() {
    const rows = collectionFor(table)
    if (table !== "contacts" && table !== "contact_merges") return rows
    return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value))
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
      if (table === "contacts") {
        const row = { id: `new-${state.rows.length + 1}`, created_at: "2026-08-18T00:00:00Z", ...payload }
        state.rows.push(row)
        return {
          data: row,
          error: null,
          select: () => ({ single: async () => ({ data: row, error: null }) }),
        }
      }
      if (table === "contact_merges") {
        const row = { id: `merge-${state.merges.length + 1}`, created_at: "2026-08-18T00:00:00Z", ...payload }
        state.merges.push(row)
        return { data: row, error: null }
      }
      if (table === "contact_timeline_events") {
        const error = state.errors.timelineInsert ?? null
        return { data: error ? null : { id: `evt-${Date.now()}`, ...payload }, error }
      }
      return { data: null, error: null }
    },
    update(patch: any) {
      return {
        eq: async (field: string, value: any) => {
          if (table === "contacts") {
            const error = state.errors.contactsUpdate ?? null
            if (error) return { data: null, error }
            const idx = state.rows.findIndex((r) => r[field] === value)
            if (idx >= 0) state.rows[idx] = { ...state.rows[idx], ...patch }
            return { data: null, error: null }
          }
          if (table === "contact_timeline_events") {
            // Re-pointing timeline rows isn't asserted on directly by any
            // test here; only that it succeeds (or is told to fail).
            return { data: null, error: null }
          }
          return { data: null, error: null }
        },
      }
    },
    delete() {
      return {
        eq: async (field: string, value: any) => {
          if (table === "contacts") {
            const idx = state.rows.findIndex((r) => r[field] === value)
            if (idx >= 0) state.rows.splice(idx, 1)
          }
          return { data: null, error: null }
        },
      }
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

import { recordContactEvent, mergeContacts } from "@/lib/db/contacts"
import { decideMerge } from "@/lib/lead-engine/merge"

beforeEach(() => {
  state.rows = []
  state.merges = []
  state.errors = {}
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

  it("does not throw when the closing timeline insert fails, and logs it", async () => {
    state.errors.timelineInsert = new Error("timeline insert boom")
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const out = await recordContactEvent({
      email: "resilient@example.com",
      source: "funnel_form",
    })

    expect(out.created).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [message] = consoleErrorSpy.mock.calls[0]
    expect(String(message)).toContain(out.contactId)
    expect(String(message)).toContain("funnel_form")

    consoleErrorSpy.mockRestore()
  })

  it("throws when the contact UPDATE fails", async () => {
    state.rows.push({
      id: "existing-2",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "willfail@example.com",
      phone_e164: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.errors.contactsUpdate = new Error("update boom")

    await expect(
      recordContactEvent({ email: "willfail@example.com", source: "funnel_form" }),
    ).rejects.toThrow("update boom")
  })
})

describe("mergeContacts", () => {
  it("is idempotent: running the same merge twice yields exactly one audit row", async () => {
    state.rows.push(
      {
        id: "contact-survivor",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: "survivor@example.com",
        phone_e164: null,
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "contact-loser",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: null,
        phone_e164: "+16176504548",
        created_at: "2021-01-01T00:00:00Z",
      },
    )

    await mergeContacts("contact-survivor", "contact-loser", "00000000-0000-0000-0000-000000000001")
    await mergeContacts("contact-survivor", "contact-loser", "00000000-0000-0000-0000-000000000001")

    const rows = state.merges.filter(
      (m) => m.survivor_id === "contact-survivor" && m.merged_id === "contact-loser",
    )
    expect(rows).toHaveLength(1)
  })
})
