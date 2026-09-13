// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: {
  rows: any[]
  merges: any[]
  timelineEvents: any[]
  consents: any[]
  sequences: any[]
  sequenceRuns: any[]
  selects: Array<{ table: string; columns: string }>
  rpcCalls: Array<{ name: string; args: any }>
  errors: { contactsUpdate?: any; timelineInsert?: any; sequencesSelect?: any; mergeContactsRpc?: any }
} = {
  rows: [],
  merges: [],
  timelineEvents: [],
  consents: [],
  sequences: [],
  sequenceRuns: [],
  selects: [],
  rpcCalls: [],
  errors: {},
}

function collectionFor(table: string): any[] {
  if (table === "contacts") return state.rows
  if (table === "contact_merges") return state.merges
  if (table === "contact_timeline_events") return state.timelineEvents
  if (table === "contact_consents") return state.consents
  if (table === "sequences") return state.sequences
  if (table === "sequence_runs") return state.sequenceRuns
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
    // Deliberately projection-BLIND for the data it returns (filterRows below
    // hands back whole seeded rows whatever the select string says), but the
    // string itself is recorded: `findMatchCandidates` casts PostgREST's
    // untyped `data` with `as MatchCandidate[]`, so a column missing from a
    // projection is invisible to tsc and invisible to every other test here.
    // Recording it is what lets a test assert the projection directly.
    select(columns?: string) {
      state.selects.push({ table, columns: columns ?? "" })
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
      // Lets a single test force `enrollIfTriggered`'s `sequences` select to
      // fail, without giving every other test in this file a `sequences`
      // table to worry about (they never seed one, so this stays inert).
      if (table === "sequences" && state.errors.sequencesSelect) {
        return res({ data: null, error: state.errors.sequencesSelect })
      }
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
      if (table === "sequence_runs") {
        const row = { id: `run-${state.sequenceRuns.length + 1}`, ...payload }
        state.sequenceRuns.push(row)
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
    // mergeContacts (Task 10) delegates entirely to this RPC — the merge's
    // actual behaviour (re-pointing children, idempotency, user_id carry,
    // business scoping) now lives in the `merge_contacts` plpgsql function
    // (supabase/migrations/00217) and is verified there, not against this
    // JS mock. What stays testable here is only that mergeContacts calls the
    // RPC with the right arguments and propagates its error.
    rpc: async (name: string, args: any) => {
      state.rpcCalls.push({ name, args })
      if (name === "merge_contacts" && state.errors.mergeContactsRpc) {
        return { data: null, error: state.errors.mergeContactsRpc }
      }
      return { data: null, error: null }
    },
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
  state.sequences = []
  state.sequenceRuns = []
  state.selects = []
  state.rpcCalls = []
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
      businessId: "00000000-0000-0000-0000-000000000001",
    })
    expect(out.created).toBe(true)
    expect(out.merged).toBe(false)
    expect(state.rows[0].email).toBe("new@example.com")
    expect(state.rows[0].phone_e164).toBe("+16176504548")
  })

  it("rejects an event carrying neither identifier", async () => {
    await expect(
      recordContactEvent({
        email: null,
        phone: null,
        source: "funnel_form",
        businessId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(/identifier/i)
  })

  it("stores the business id the CALLER passed, not a default", async () => {
    // `businessId` is required and has no default any more, so the only way
    // a row can carry a tenant is for the caller to have named one. A
    // deliberately non-platform id: if this ever came back as
    // 00000000-0000-0000-0000-000000000001 it would mean something upstream
    // had reintroduced a fallback and quietly overruled the caller.
    await recordContactEvent({ email: "a@b.com", source: "newsletter", businessId: "biz-coach-2" })
    expect(state.rows[0].business_id).toBe("biz-coach-2")
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
      businessId: "00000000-0000-0000-0000-000000000001",
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
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    expect(out.created).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [message] = consoleErrorSpy.mock.calls[0]
    expect(String(message)).toContain(out.contactId)
    expect(String(message)).toContain("funnel_form")

    consoleErrorSpy.mockRestore()
  })

  it("never throws out of recordContactEvent when enrolment fails, and logs code/message only", async () => {
    // Shaped like a real Postgres error: `details`/`hint` are the fields a
    // unique-index violation on contacts embeds the literal email address
    // in (see lib/funnels/capture-contact.ts). They must never reach the log.
    state.errors.sequencesSelect = {
      code: "42501",
      message: "permission denied for table sequences",
      details: "PII-SHAPED-DETAIL-must-not-appear",
      hint: "PII-SHAPED-HINT-must-not-appear",
    }
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const out = await recordContactEvent({
      email: "enroll-resilient@example.com",
      source: "funnel_form",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    // The contact write itself is unaffected — enrolment failing is
    // marketing, not the lead record.
    expect(out.created).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [message, meta] = consoleErrorSpy.mock.calls[0]
    expect(String(message)).toContain(out.contactId)
    expect(String(message)).toContain("funnel_form")
    expect(meta).toEqual({ code: "42501", message: "permission denied for table sequences" })

    const serializedCall = JSON.stringify(consoleErrorSpy.mock.calls[0])
    expect(serializedCall).not.toContain("PII-SHAPED-DETAIL-must-not-appear")
    expect(serializedCall).not.toContain("PII-SHAPED-HINT-must-not-appear")

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
      businessId: "00000000-0000-0000-0000-000000000001",
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
      businessId: "00000000-0000-0000-0000-000000000001",
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

  it("backfills first_touch_session_id on an existing contact that has none", async () => {
    // MUTANT KILLED: leaving the session write on the CREATE branch only
    // (audit §3.5). Someone who first arrived before /go landings stamped a
    // cookie — or who arrived organically at all — has a contact row with a
    // null first_touch_session_id forever, because every later submission
    // takes the update branch and the update branch never wrote the column.
    state.rows.push({
      id: "contact-no-session",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "nosession@example.com",
      phone_e164: null,
      first_touch_session_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "nosession@example.com",
      source: "newsletter",
      attributionSessionId: "sess-2",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    const row = state.rows.find((r) => r.id === "contact-no-session")
    expect(row.first_touch_session_id).toBe("sess-2")
  })

  it("never overwrites a first_touch_session_id already on file", async () => {
    // MUTANT KILLED: dropping the `existing?.first_touch_session_id == null`
    // guard so the patch always writes. FIRST touch is the whole point of the
    // column: the session that brought this person in the first time is the
    // one that gets credit for the eventual sale. Overwriting it on every
    // later visit would re-credit the last touch and quietly rewrite history.
    state.rows.push({
      id: "contact-has-session",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "hassession@example.com",
      phone_e164: null,
      first_touch_session_id: "sess-1",
      created_at: "2020-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "hassession@example.com",
      source: "newsletter",
      attributionSessionId: "sess-2",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    const row = state.rows.find((r) => r.id === "contact-has-session")
    expect(row.first_touch_session_id).toBe("sess-1")
  })

  it("leaves a null first_touch_session_id alone when the event carries no session", async () => {
    // The absence of a session is not a session. Writing null over null is
    // harmless, but writing an empty string (or "undefined") would not be, and
    // this pins that the patch simply does not fire.
    state.rows.push({
      id: "contact-still-null",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "stillnull@example.com",
      phone_e164: null,
      first_touch_session_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "stillnull@example.com",
      source: "newsletter",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    const row = state.rows.find((r) => r.id === "contact-still-null")
    expect(row.first_touch_session_id).toBeNull()
  })

  it("does not backfill over a merge, where the LOSER carried the earlier session", async () => {
    // MUTANT KILLED: reading only the survivor's pre-merge row on the merge
    // branch (`existing?.first_touch_session_id` alone). `merge_contacts`
    // (migration 00238) moves the loser's session onto a survivor that has
    // none, because first touch must be the EARLIER of the two — so a
    // survivor whose pre-merge value is null may have just been given a truer
    // session than the one in front of us. Writing ours over it would
    // misattribute every dollar of this contact's revenue to the wrong
    // campaign, which is the exact thing that SQL block exists to prevent.
    state.rows.push({
      id: "survivor-older",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: "merge@example.com",
      phone_e164: null,
      first_touch_session_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-newer",
      business_id: "00000000-0000-0000-0000-000000000001",
      email: null,
      phone_e164: "+16176504548",
      first_touch_session_id: "sess-loser",
      created_at: "2021-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "merge@example.com",
      phone: "617-650-4548",
      source: "newsletter",
      attributionSessionId: "sess-now",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    expect(out.merged).toBe(true)
    expect(out.contactId).toBe("survivor-older")
    // The real merge_contacts RPC is stubbed here, so the survivor's column is
    // still null; what this pins is that OUR patch did not write to it.
    const row = state.rows.find((r) => r.id === "survivor-older")
    // The exact invariant, not merely "something other than ours": our patch
    // wrote nothing at all, and the real merge_contacts RPC (stubbed here) is
    // the only thing entitled to fill this column on a merge.
    expect(row.first_touch_session_id).toBeNull()
  })

  it("selects first_touch_session_id in BOTH match queries, not just one", async () => {
    // MUTANT KILLED: dropping `first_touch_session_id` from either projection
    // in findMatchCandidates (the email query or the phone query).
    //
    // Nothing else in this repo can catch that. `findMatchCandidates` casts
    // PostgREST's untyped `data` with `as MatchCandidate[]`, and a cast from a
    // narrower shape is always legal, so tsc sees no error however required
    // the field is on the type. And this file's own table mock is projection-
    // blind: it returns the whole seeded row regardless of the select string,
    // so every other test here would stay green. In production the omission
    // reads as `undefined` — indistinguishable from "no session on file" to
    // firstTouchSessionPatch, which would then overwrite a genuine first touch
    // with the current request's on the very next submission.
    await recordContactEvent({
      email: "projection@example.com",
      phone: "617-650-4548",
      source: "newsletter",
      businessId: "00000000-0000-0000-0000-000000000001",
    })

    const contactSelects = state.selects.filter((s) => s.table === "contacts")
    expect(contactSelects).toHaveLength(2)
    for (const sel of contactSelects) {
      expect(sel.columns).toContain("first_touch_session_id")
    }
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
      recordContactEvent({
        email: "willfail@example.com",
        source: "funnel_form",
        businessId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow("update boom")
  })
})

// Task 10: mergeContacts became a single `.rpc("merge_contacts", …)` call —
// see lib/db/contacts.ts. The merge's actual behaviour (re-pointing all five
// child tables, idempotency on retry, user_id carry-over, conflict recording,
// business-id scoping) now lives entirely inside the `merge_contacts` plpgsql
// function (supabase/migrations/00217_lead_engine_sequence_functions.sql)
// and was verified there against a live Postgres instance in Task 1 — it is
// no longer JS the DAL executes, so it is not re-tested against a JS mock
// here. What this file can and must still pin: that mergeContacts calls the
// RPC with exactly the arguments the caller passed, and that an error the
// RPC returns is not swallowed.
describe("mergeContacts", () => {
  it("delegates to the merge_contacts RPC with the survivor, merged id, business id, and reason", async () => {
    await mergeContacts("contact-survivor", "contact-loser", "00000000-0000-0000-0000-000000000001")

    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0]).toEqual({
      name: "merge_contacts",
      args: {
        p_survivor: "contact-survivor",
        p_merged: "contact-loser",
        p_business: "00000000-0000-0000-0000-000000000001",
        p_reason: "email and phone resolved to different contacts",
      },
    })
  })

  it("throws when the merge_contacts RPC returns an error", async () => {
    state.errors.mergeContactsRpc = new Error("merge_contacts boom")

    await expect(
      mergeContacts("contact-survivor", "contact-loser", "00000000-0000-0000-0000-000000000001"),
    ).rejects.toThrow("merge_contacts boom")
  })
})
