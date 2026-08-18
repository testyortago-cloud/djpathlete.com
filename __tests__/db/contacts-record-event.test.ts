// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: {
  rows: any[]
  merges: any[]
  timelineEvents: any[]
  consents: any[]
  errors: { contactsUpdate?: any; timelineInsert?: any }
} = { rows: [], merges: [], timelineEvents: [], consents: [], errors: {} }

function collectionFor(table: string): any[] {
  if (table === "contacts") return state.rows
  if (table === "contact_merges") return state.merges
  if (table === "contact_timeline_events") return state.timelineEvents
  if (table === "contact_consents") return state.consents
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
    return collectionFor(table).filter((row) =>
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
        if (error) return { data: null, error }
        const row = { id: `evt-${state.timelineEvents.length + 1}`, ...payload }
        state.timelineEvents.push(row)
        return { data: row, error: null }
      }
      if (table === "contact_consents") {
        const row = { id: `consent-${state.consents.length + 1}`, ...payload }
        state.consents.push(row)
        return { data: row, error: null }
      }
      return { data: null, error: null }
    },
    update(patch: any) {
      return {
        eq: async (field: string, value: any) => {
          if (table === "contacts" && state.errors.contactsUpdate) {
            return { data: null, error: state.errors.contactsUpdate }
          }
          // Generic: applies the patch to every row in this table's backing
          // collection matching `field === value`. Real UPDATE...WHERE can
          // affect more than one row, which matters for the re-point calls
          // (`.update({ contact_id: survivorId }).eq("contact_id", mergedId)`)
          // that move every timeline/consent row off the loser at once.
          const rows = collectionFor(table)
          for (let i = 0; i < rows.length; i++) {
            if (rows[i][field] === value) rows[i] = { ...rows[i], ...patch }
          }
          return { data: null, error: null }
        },
      }
    },
    delete() {
      const delFilters: Record<string, any> = {}
      const delApi: any = {
        eq(field: string, value: any) {
          delFilters[field] = value
          return delApi
        },
        then(res: any) {
          if (table === "contacts") {
            const idx = state.rows.findIndex((r) =>
              Object.entries(delFilters).every(([k, v]) => r[k] === v),
            )
            if (idx >= 0) state.rows.splice(idx, 1)
          }
          return res({ data: null, error: null })
        },
      }
      return delApi
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
  state.timelineEvents = []
  state.consents = []
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

  it("fills a null identifier on an existing contact rather than discarding it", async () => {
    state.rows.push({
      id: "contact-fill",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "hasemailonly@example.com",
      phone_e164: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "hasemailonly@example.com",
      phone: "617-650-4548",
      source: "funnel_form",
    })

    expect(out.contactId).toBe("contact-fill")
    const row = state.rows.find((r) => r.id === "contact-fill")
    expect(row.phone_e164).toBe("+16176504548")
    expect(state.timelineEvents.some((e) => e.kind === "identifier_conflict")).toBe(false)
  })

  it("does not overwrite a conflicting identifier, and records a timeline row instead", async () => {
    state.rows.push({
      id: "contact-conflict",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "shared@example.com",
      phone_e164: "+16176504548",
      created_at: "2020-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "shared@example.com",
      phone: "212-555-0100",
      source: "funnel_form",
    })

    expect(out.contactId).toBe("contact-conflict")
    // The phone on file is untouched — the submitted one did NOT win.
    const row = state.rows.find((r) => r.id === "contact-conflict")
    expect(row.phone_e164).toBe("+16176504548")

    const conflictEvents = state.timelineEvents.filter((e) => e.kind === "identifier_conflict")
    expect(conflictEvents).toHaveLength(1)
    expect(conflictEvents[0].contact_id).toBe("contact-conflict")
    expect(conflictEvents[0].metadata).toMatchObject({
      field: "phone",
      submitted: "+12125550100",
      existing: "+16176504548",
    })
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

  it("re-points the loser's consent rows onto the survivor before deleting it", async () => {
    state.rows.push(
      {
        id: "consent-survivor",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: "survivor@example.com",
        phone_e164: null,
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "consent-loser",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: null,
        phone_e164: "+16176504548",
        created_at: "2021-01-01T00:00:00Z",
      },
    )
    state.consents.push({
      id: "existing-consent",
      business_id: "00000000-0000-0000-0000-000000000001",
      contact_id: "consent-loser",
      channel: "sms",
      granted: true,
      source: "funnel_form",
      wording_shown: "You agree to receive texts.",
    })

    await mergeContacts("consent-survivor", "consent-loser", "00000000-0000-0000-0000-000000000001")

    // The loser is gone...
    expect(state.rows.some((r) => r.id === "consent-loser")).toBe(false)
    // ...but its consent record survived the delete, re-pointed to the survivor.
    const consent = state.consents.find((c) => c.id === "existing-consent")
    expect(consent).toBeDefined()
    expect(consent.contact_id).toBe("consent-survivor")
  })

  it("carries the loser's user_id onto the survivor when the survivor has none", async () => {
    state.rows.push(
      {
        id: "uid-survivor",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: "survivor2@example.com",
        phone_e164: null,
        user_id: null,
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "uid-loser",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: null,
        phone_e164: "+16178675309",
        user_id: "user-42",
        created_at: "2021-01-01T00:00:00Z",
      },
    )

    await mergeContacts("uid-survivor", "uid-loser", "00000000-0000-0000-0000-000000000001")

    const survivor = state.rows.find((r) => r.id === "uid-survivor")
    expect(survivor.user_id).toBe("user-42")
  })

  it("does not guess when both contacts carry different user_ids — keeps the survivor's and records the conflict", async () => {
    state.rows.push(
      {
        id: "uidconflict-survivor",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: "survivor3@example.com",
        phone_e164: null,
        user_id: "user-keep-me",
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "uidconflict-loser",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: null,
        phone_e164: "+16179998888",
        user_id: "user-other",
        created_at: "2021-01-01T00:00:00Z",
      },
    )

    await mergeContacts("uidconflict-survivor", "uidconflict-loser", "00000000-0000-0000-0000-000000000001")

    const survivor = state.rows.find((r) => r.id === "uidconflict-survivor")
    expect(survivor.user_id).toBe("user-keep-me")

    const conflictEvents = state.timelineEvents.filter((e) => e.kind === "user_id_conflict")
    expect(conflictEvents).toHaveLength(1)
    expect(conflictEvents[0].metadata).toMatchObject({
      survivor_user_id: "user-keep-me",
      loser_user_id: "user-other",
    })
  })

  it("does not delete the loser when its business_id does not match the merge's business_id", async () => {
    state.rows.push(
      {
        id: "scope-survivor",
        business_id: "00000000-0000-0000-0000-000000000001",
        email: "survivor4@example.com",
        phone_e164: null,
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "scope-loser",
        business_id: "some-other-business",
        email: null,
        phone_e164: "+16171234567",
        created_at: "2021-01-01T00:00:00Z",
      },
    )

    await mergeContacts("scope-survivor", "scope-loser", "00000000-0000-0000-0000-000000000001")

    // The loser belongs to a different business than the one this merge was
    // scoped to, so it must not be touched.
    expect(state.rows.some((r) => r.id === "scope-loser")).toBe(true)
  })
})
