// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: {
  rows: any[]
  merges: any[]
  timelineEvents: any[]
  consents: any[]
  sequences: any[]
  sequenceRuns: any[]
  // `users` rows the account link (G04) may resolve against. Seeded only by
  // the tests that need one; every older test leaves it empty, which is the
  // "this person has no account" case those tests always implicitly assumed.
  users: any[]
  selects: Array<{ table: string; columns: string }>
  rpcCalls: Array<{ name: string; args: any }>
  errors: {
    contactsUpdate?: any
    timelineInsert?: any
    sequencesSelect?: any
    mergeContactsRpc?: any
    // Fails ONLY the `users` lookup keyed on `id`, so a test can prove the
    // email fallback still runs when the id branch throws.
    usersSelectById?: any
  }
} = {
  rows: [],
  merges: [],
  timelineEvents: [],
  consents: [],
  sequences: [],
  sequenceRuns: [],
  users: [],
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
  if (table === "users") return state.users
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
      if (table === "users" && filters.id !== undefined && state.errors.usersSelectById) {
        return { data: null, error: state.errors.usersSelectById }
      }
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
      // Chainable, like the real builder: `.eq()` / `.is()` narrow the rows,
      // `.select()` is a no-op, and awaiting at any point applies the patch.
      // Generic: applies the patch to every row in this table's backing
      // collection matching every filter (AND). Real UPDATE...WHERE can
      // affect more than one row, which matters for the re-point calls
      // (`.update({ contact_id: survivorId }).eq("contact_id", mergedId)`)
      // that move every timeline/consent row off the loser at once, and for
      // `linkContactsToUser`, which fills every unlinked row for one email.
      const updFilters: Array<{ field: string; value: any; op: "eq" | "is" }> = []
      function applyPatch() {
        if (table === "contacts" && state.errors.contactsUpdate) {
          return { data: null, error: state.errors.contactsUpdate }
        }
        const rows = collectionFor(table)
        const touched: any[] = []
        for (let i = 0; i < rows.length; i++) {
          const matches = updFilters.every((f) =>
            // `.is(col, null)` matches a seeded row that never set the key at
            // all, the same way SQL `IS NULL` does not care how the null arose.
            f.op === "is" ? rows[i][f.field] == f.value : rows[i][f.field] === f.value,
          )
          if (matches) {
            rows[i] = { ...rows[i], ...patch }
            touched.push(rows[i])
          }
        }
        return { data: touched, error: null }
      }
      const updApi: any = {
        eq(field: string, value: any) {
          updFilters.push({ field, value, op: "eq" })
          return updApi
        },
        is(field: string, value: any) {
          updFilters.push({ field, value, op: "is" })
          return updApi
        },
        select() {
          return updApi
        },
        then(res: any) {
          return res(applyPatch())
        },
      }
      return updApi
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

import { recordContactEvent, mergeContacts, linkContactsToUser, backfillContactTimezone } from "@/lib/db/contacts"
import { decideMerge } from "@/lib/lead-engine/merge"

beforeEach(() => {
  state.rows = []
  state.merges = []
  state.timelineEvents = []
  state.consents = []
  state.sequences = []
  state.sequenceRuns = []
  state.users = []
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

// G04 (ledger 2026-09-19): `contacts.user_id` had no writer. 0 of 170
// production contacts were linked while 54 shared an email with a `users`
// row, so the `has_user` ("already a client") branch in every quiz sequence
// was permanently false. The link is FILL-ONLY, like first_touch_session_id:
// written on create, backfilled on update/merge when the row has none, and
// never replaced once set.
describe("recordContactEvent — linking the contact to the person's account (G04)", () => {
  const BIZ = "00000000-0000-0000-0000-000000000001"

  it("links a new contact to the account whose email matches", async () => {
    state.users.push({ id: "user-1", email: "new@example.com", status: "active" })

    await recordContactEvent({ email: "New@Example.com", source: "funnel_form", businessId: BIZ })

    expect(state.rows[0].user_id).toBe("user-1")
  })

  it("leaves a new contact unlinked when no account matches", async () => {
    state.users.push({ id: "user-other", email: "someone@else.com", status: "active" })

    await recordContactEvent({ email: "new@example.com", source: "funnel_form", businessId: BIZ })

    expect(state.rows[0].user_id).toBeNull()
  })

  it("does not link to a lead-status placeholder — that row is not an account the person can use", async () => {
    // app/api/contact, /api/inquiry and the funnel checkout all mint a
    // `status: "lead"` users row for a stranger. It has no password and
    // cannot log in; treating it as "already a client" would send a lead
    // the wrong arm of every quiz sequence. Registration upgrades that
    // same row to `active`, and the register route links the contact then.
    state.users.push({ id: "user-lead", email: "new@example.com", status: "lead" })

    await recordContactEvent({ email: "new@example.com", source: "funnel_form", businessId: BIZ })

    expect(state.rows[0].user_id).toBeNull()
  })

  it("does not link by a caller's userId whose account email is not the row's email — a receipt address is not proof of identity", async () => {
    // Review finding I1. The one-time program and week checkouts pin no
    // customer email, so a logged-in buyer can type ANY address into Stripe:
    // Dad buys while signed in and types mom@ for the receipt. The contact
    // minted for mom@ is Mom, not Dad, and a link is permanent (fill-only).
    state.users.push({ id: "user-2", email: "account@example.com", status: "active" })

    await recordContactEvent({ email: "other@example.com", userId: "user-2", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBeNull()
  })

  it("links by the caller's userId when its account email differs from the contact's only by case", async () => {
    // The one cohort the exact-match email lookup cannot reach: `users`
    // stores the address as typed (two legacy rows on production are
    // mixed-case), `contacts.email` is always lower-cased. The id lookup plus
    // a normalised compare is what makes `userId` worth passing at all.
    state.users.push({ id: "user-mixed", email: "Client@Example.com", status: "active" })

    await recordContactEvent({ email: "client@example.com", userId: "user-mixed", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBe("user-mixed")
  })

  it("links by the caller's userId on a phone-only contact, which has no email to disagree with", async () => {
    state.users.push({ id: "user-phone", email: "somebody@example.com", status: "active" })

    await recordContactEvent({ phone: "617-650-4548", userId: "user-phone", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBe("user-phone")
  })

  it("falls back to the email match when the id lookup itself fails", async () => {
    // Review finding I2: the two lookups must not share one try — a fault on
    // `.eq("id", …)` (a transient error, a non-UUID id) must still let the
    // email branch run, or the doc comment's "recoverable" promise is hollow.
    state.errors.usersSelectById = { code: "22P02", message: "invalid input syntax for type uuid" }
    state.users.push({ id: "user-3", email: "new@example.com", status: "active" })
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await recordContactEvent({ email: "new@example.com", userId: "not-a-uuid", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBe("user-3")
    consoleErrorSpy.mockRestore()
  })

  it("does not link a contact by an email it just refused to write (shared phone, different person)", async () => {
    // Review finding C1. Alice's contact carries the household phone. Bob —
    // who has an account — submits the inquiry form with his own email and
    // that phone. The phone match selects Alice's row; buildIdentifierPatch
    // refuses to overwrite her email with his and records a conflict. The
    // link must follow the SAME rule: the account is resolved from the email
    // ON the row, never from the one that was just rejected — or Alice's
    // contact becomes Bob's, permanently.
    state.rows.push({
      id: "contact-alice",
      business_id: BIZ,
      email: "alice@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-bob", email: "bob@example.com", status: "active" })

    const out = await recordContactEvent({
      email: "bob@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.contactId).toBe("contact-alice")
    const row = state.rows.find((r) => r.id === "contact-alice")
    expect(row.user_id).toBeNull()
    // The presence control: the conflict path really ran, so this did not
    // pass by nothing happening.
    const conflicts = state.timelineEvents.filter((e) => e.kind === "identifier_conflict")
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].metadata).toMatchObject({ field: "email", submitted: "bob@example.com" })
  })

  it("links a phone-only contact by the email it is learning for the FIRST time", async () => {
    // The other half of `existing?.email ?? email`, and the one a conflict
    // test cannot reach. This row has no email, so there is nothing to
    // conflict with: buildIdentifierPatch WRITES the submitted address, which
    // makes it the email on the row, which makes it the right thing to
    // resolve the account from — in this same request. Resolving from the
    // row's own (null) email instead would leave the link waiting for a
    // later submission that may never come.
    state.rows.push({
      id: "contact-phone-only",
      business_id: BIZ,
      email: null,
      phone_e164: "+16176504548",
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-dana", email: "dana@example.com", status: "active" })

    const out = await recordContactEvent({
      email: "dana@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.contactId).toBe("contact-phone-only")
    const row = state.rows.find((r) => r.id === "contact-phone-only")
    // Presence control: the email really was filled, so the link below is
    // being resolved from an address that is now ON the row.
    expect(row.email).toBe("dana@example.com")
    expect(row.user_id).toBe("user-dana")
  })

  it("links the row to ITS OWN person's account when the submitted email conflicts", async () => {
    // Same shape as above, but Alice has an account: the row is hers, so
    // that is the account it links to — fill-only and true, whoever
    // triggered the write.
    state.rows.push({
      id: "contact-alice",
      business_id: BIZ,
      email: "alice@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-bob", email: "bob@example.com", status: "active" })
    state.users.push({ id: "user-alice", email: "alice@example.com", status: "active" })

    await recordContactEvent({ email: "bob@example.com", phone: "617-650-4548", source: "inquiry", businessId: BIZ })

    expect(state.rows.find((r) => r.id === "contact-alice").user_id).toBe("user-alice")
  })

  it("on a merge, links by the survivor's own email, never a conflicting submitted one", async () => {
    // Carol's older row holds the phone; Bob's newer row holds his email. Bob
    // submits both, the two rows merge into Carol's (older survives), and
    // Carol's email wins the conflict. The link must not hand Carol's
    // surviving row to Bob's account.
    state.rows.push({
      id: "survivor-carol",
      business_id: BIZ,
      email: "carol@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-bob",
      business_id: BIZ,
      email: "bob@example.com",
      phone_e164: null,
      user_id: null,
      created_at: "2021-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-bob", email: "bob@example.com", status: "active" })

    const out = await recordContactEvent({
      email: "bob@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.merged).toBe(true)
    expect(out.contactId).toBe("survivor-carol")
    expect(state.rows.find((r) => r.id === "survivor-carol").user_id).toBeNull()
    expect(state.timelineEvents.some((e) => e.kind === "identifier_conflict")).toBe(true)
  })

  it("on a merge into a phone-only survivor, links by the email the merge fills in", async () => {
    // The merge-branch twin of the phone-only case above, and the one the
    // conflict test cannot reach: here the survivor has NO email, so there is
    // no conflict — buildIdentifierPatch writes the submitted address onto
    // the survivor, and that address is therefore the row's own. Resolving
    // from the survivor's pre-merge (null) email would leave the merged row
    // unlinked even though its person plainly has an account.
    state.rows.push({
      id: "survivor-phone",
      business_id: BIZ,
      email: null,
      phone_e164: "+16176504548",
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-erin",
      business_id: BIZ,
      email: "erin@example.com",
      phone_e164: null,
      user_id: null,
      created_at: "2021-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-erin", email: "erin@example.com", status: "active" })

    const out = await recordContactEvent({
      email: "erin@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.merged).toBe(true)
    expect(out.contactId).toBe("survivor-phone")
    const row = state.rows.find((r) => r.id === "survivor-phone")
    // Presence control: no conflict happened, the email really was filled.
    expect(row.email).toBe("erin@example.com")
    expect(row.user_id).toBe("user-erin")
  })

  it("ignores a userId that names no users row, so the FK can never fail the contact write", async () => {
    // contacts.user_id REFERENCES users(id). A stale id (a user deleted
    // between checkout and webhook delivery) would otherwise turn the whole
    // insert into a 23503 and lose the lead.
    await recordContactEvent({ email: "new@example.com", userId: "ghost", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBeNull()
  })

  it("ignores a userId that names a lead-status placeholder", async () => {
    state.users.push({ id: "user-lead", email: "new@example.com", status: "lead" })

    await recordContactEvent({ email: "new@example.com", userId: "user-lead", source: "purchase", businessId: BIZ })

    expect(state.rows[0].user_id).toBeNull()
  })

  it("fills user_id on an existing contact that has none (update branch)", async () => {
    // MUTANT KILLED: writing the link on the CREATE branch only. Every one
    // of the 54 unlinked production contacts takes the update branch on its
    // next submission; a create-only writer would leave all of them
    // unlinked forever, exactly as first_touch_session_id once was.
    state.rows.push({
      id: "contact-unlinked",
      business_id: BIZ,
      email: "client@example.com",
      phone_e164: null,
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-3", email: "client@example.com", status: "active" })

    await recordContactEvent({ email: "client@example.com", source: "quiz", businessId: BIZ })

    const row = state.rows.find((r) => r.id === "contact-unlinked")
    expect(row.user_id).toBe("user-3")
  })

  it("never overwrites a link already on file, and does not even look one up", async () => {
    // MUTANT KILLED: dropping the `existing.user_id == null` guard. The
    // caller's userId and a matching account BOTH disagree with the stored
    // link here (and would each be accepted on an unlinked row — the
    // account's email IS the row's email), and neither may win: a contact is
    // one person, and the person it was first linked to is who it stays.
    state.rows.push({
      id: "contact-linked",
      business_id: BIZ,
      email: "client@example.com",
      phone_e164: null,
      user_id: "user-original",
      created_at: "2020-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-newer", email: "client@example.com", status: "active" })

    await recordContactEvent({ email: "client@example.com", userId: "user-newer", source: "quiz", businessId: BIZ })

    const row = state.rows.find((r) => r.id === "contact-linked")
    expect(row.user_id).toBe("user-original")
    expect(state.selects.filter((s) => s.table === "users")).toHaveLength(0)
  })

  it("does not write user_id over a merge where the LOSER carried the link", async () => {
    // Same shape as the first-touch merge rule: `merge_contacts` (00217)
    // copies the loser's user_id onto a survivor that has none, inside the
    // RPC. A survivor whose pre-merge value is null may therefore have just
    // been linked by the RPC to a truer account than the one in front of us.
    // Our patch must write nothing when EITHER pre-merge row was linked.
    state.rows.push({
      id: "survivor-older",
      business_id: BIZ,
      email: "merge@example.com",
      phone_e164: null,
      user_id: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-newer",
      business_id: BIZ,
      email: null,
      phone_e164: "+16176504548",
      user_id: "user-from-loser",
      created_at: "2021-01-01T00:00:00Z",
    })
    state.users.push({ id: "user-now", email: "merge@example.com", status: "active" })

    const out = await recordContactEvent({
      email: "merge@example.com",
      phone: "617-650-4548",
      source: "newsletter",
      businessId: BIZ,
    })

    expect(out.merged).toBe(true)
    // The RPC is stubbed, so the survivor is still null — what this pins is
    // that OUR patch did not write to it.
    const row = state.rows.find((r) => r.id === "survivor-older")
    expect(row.user_id).toBeNull()
    expect(state.selects.filter((s) => s.table === "users")).toHaveLength(0)
  })

  it("selects user_id in BOTH match queries, not just one", async () => {
    // Same reasoning as the first_touch_session_id projection test above: a
    // column missing from either projection reads as `undefined`, which the
    // fill-only guard cannot tell from "unlinked", and the next submission
    // would overwrite a real link.
    await recordContactEvent({
      email: "projection@example.com",
      phone: "617-650-4548",
      source: "newsletter",
      businessId: BIZ,
    })

    const contactSelects = state.selects.filter((s) => s.table === "contacts")
    expect(contactSelects).toHaveLength(2)
    for (const sel of contactSelects) {
      expect(sel.columns).toContain("user_id")
    }
  })
})

// G06 (ledger 2026-09-19, D8): `contacts.timezone` has a READER and no writer.
// `resolveTimezone` (lib/lead-engine/guardrails.ts) prefers the contact's own
// zone and falls back to the business default — and on production 0 of 170
// contacts had one, so quiet hours were New York time for a lead in Auckland.
// Fill-only for the same reason as the account link: a person's timezone comes
// from the device they filled a form on, and a later submission from a laptop
// in an airport must not overwrite where they actually live.
describe("recordContactEvent — storing the contact's own timezone (G06)", () => {
  const BIZ = "00000000-0000-0000-0000-000000000001"

  it("stores a submitted IANA timezone on a new contact", async () => {
    await recordContactEvent({
      email: "tz@example.com",
      source: "funnel_form",
      businessId: BIZ,
      timezone: "Pacific/Auckland",
    })

    expect(state.rows[0].timezone).toBe("Pacific/Auckland")
  })

  it("leaves timezone null when the form sent none", async () => {
    await recordContactEvent({ email: "notz@example.com", source: "funnel_form", businessId: BIZ })

    expect(state.rows[0].timezone).toBeNull()
  })

  it("refuses a timezone that names no real zone, rather than storing junk", async () => {
    // A reader passes this straight to Intl; an unparseable zone would throw
    // inside the tick and FAIL the run (visible, but it costs the send). The
    // contact is still captured — a bad timezone must never cost the lead.
    await recordContactEvent({
      email: "junk@example.com",
      source: "funnel_form",
      businessId: BIZ,
      timezone: "Mars/Olympus_Mons",
    })

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].timezone).toBeNull()
  })

  it("backfills a timezone onto an existing contact that has none (update branch)", async () => {
    state.rows.push({
      id: "existing-tz",
      business_id: BIZ,
      email: "fill@example.com",
      phone_e164: null,
      user_id: null,
      timezone: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "fill@example.com",
      source: "quiz",
      businessId: BIZ,
      timezone: "Europe/Lisbon",
    })

    expect(state.rows.find((r) => r.id === "existing-tz").timezone).toBe("Europe/Lisbon")
  })

  it("never overwrites a timezone already on file", async () => {
    state.rows.push({
      id: "settled-tz",
      business_id: BIZ,
      email: "settled@example.com",
      phone_e164: null,
      user_id: null,
      timezone: "Pacific/Auckland",
      created_at: "2020-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "settled@example.com",
      source: "quiz",
      businessId: BIZ,
      timezone: "America/New_York",
    })

    expect(state.rows.find((r) => r.id === "settled-tz").timezone).toBe("Pacific/Auckland")
  })

  it("on a merge, the survivor keeps its own timezone — the loser's does not win", async () => {
    // The merge rule had NO test: deleting the whole `timezonePatch` line from
    // the merge branch left every suite green, because no existing fixture
    // seeds a timezone on either row. `merge_contacts` does not move this
    // column (unlike user_id), so the survivor's own value is simply its own.
    state.rows.push({
      id: "survivor-tz",
      business_id: BIZ,
      email: "survivor@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      timezone: "Pacific/Auckland",
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-tz",
      business_id: BIZ,
      email: "loser@example.com",
      phone_e164: null,
      user_id: null,
      timezone: "Asia/Dubai",
      created_at: "2021-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "loser@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.merged).toBe(true)
    expect(state.rows.find((r) => r.id === "survivor-tz").timezone).toBe("Pacific/Auckland")
  })

  it("on a merge, rescues the LOSER's timezone when the survivor has none", async () => {
    // The other half. `merge_contacts` does not carry this column, so the
    // loser's zone is about to be destroyed with its row — it is the same kind
    // of evidence as the submission (a real device on a real form), so it is
    // worth keeping when the survivor has nothing and the submission brought
    // nothing.
    state.rows.push({
      id: "survivor-blank",
      business_id: BIZ,
      email: "blank@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      timezone: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-lisbon",
      business_id: BIZ,
      email: "lisbon@example.com",
      phone_e164: null,
      user_id: null,
      timezone: "Europe/Lisbon",
      created_at: "2021-01-01T00:00:00Z",
    })

    const out = await recordContactEvent({
      email: "lisbon@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
    })

    expect(out.merged).toBe(true)
    expect(state.rows.find((r) => r.id === "survivor-blank").timezone).toBe("Europe/Lisbon")
  })

  it("on a merge, a JUNK submitted zone does not destroy the loser's good one", async () => {
    // `??` on the submission would stop at a non-null junk value, which
    // `timezonePatch` then rejects — losing the loser's real zone for nothing.
    state.rows.push({
      id: "survivor-junk",
      business_id: BIZ,
      email: "junksurv@example.com",
      phone_e164: "+16176504548",
      user_id: null,
      timezone: null,
      created_at: "2020-01-01T00:00:00Z",
    })
    state.rows.push({
      id: "loser-good",
      business_id: BIZ,
      email: "goodtz@example.com",
      phone_e164: null,
      user_id: null,
      timezone: "Europe/Lisbon",
      created_at: "2021-01-01T00:00:00Z",
    })

    await recordContactEvent({
      email: "goodtz@example.com",
      phone: "617-650-4548",
      source: "inquiry",
      businessId: BIZ,
      timezone: "Mars/Olympus_Mons",
    })

    expect(state.rows.find((r) => r.id === "survivor-junk").timezone).toBe("Europe/Lisbon")
  })

  it("backfillContactTimezone fills a contact from a booking, fill-only in the WHERE", async () => {
    // The Calendly half. Fill-only is enforced by `.is("timezone", null)` in
    // the update rather than by reading first, so what this pins is that the
    // predicate is actually applied — an update that reached the row without
    // it would overwrite a zone already on file.
    state.rows.push({
      id: "booked-contact",
      business_id: BIZ,
      email: "booked@example.com",
      phone_e164: null,
      user_id: null,
      timezone: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    const filled = await backfillContactTimezone("booked-contact", "Pacific/Auckland", BIZ)

    expect(filled).toBe(true)
    expect(state.rows.find((r) => r.id === "booked-contact").timezone).toBe("Pacific/Auckland")
  })

  it("backfillContactTimezone never overwrites a timezone already on file", async () => {
    // The case that actually needs `.is("timezone", null)` in the WHERE. The
    // fill test above passes with or without the predicate, because its row
    // is null either way — mutation found exactly that gap. Someone who told
    // a form they live in Auckland, then books a slot while travelling, must
    // not be moved to the airport's timezone.
    state.rows.push({
      id: "already-tz",
      business_id: BIZ,
      email: "settledtz@example.com",
      phone_e164: null,
      user_id: null,
      timezone: "Pacific/Auckland",
      created_at: "2020-01-01T00:00:00Z",
    })

    const filled = await backfillContactTimezone("already-tz", "Asia/Dubai", BIZ)

    expect(filled).toBe(false)
    expect(state.rows.find((r) => r.id === "already-tz").timezone).toBe("Pacific/Auckland")
  })

  it("backfillContactTimezone refuses a zone Intl cannot parse, without touching the row", async () => {
    state.rows.push({
      id: "junk-tz-contact",
      business_id: BIZ,
      email: "junktz@example.com",
      phone_e164: null,
      user_id: null,
      timezone: null,
      created_at: "2020-01-01T00:00:00Z",
    })

    const filled = await backfillContactTimezone("junk-tz-contact", "Mars/Olympus_Mons", BIZ)

    expect(filled).toBe(false)
    expect(state.rows.find((r) => r.id === "junk-tz-contact").timezone).toBeNull()
  })

  it("backfillContactTimezone does nothing when the booking carried no timezone", async () => {
    const filled = await backfillContactTimezone("anything", null, BIZ)
    expect(filled).toBe(false)
  })

  it("selects timezone in BOTH match queries, not just one", async () => {
    // Same reasoning as the user_id and first_touch_session_id projection
    // tests: a column missing from either projection reads as `undefined`,
    // which the fill-only guard cannot tell from "no timezone on file", and
    // the next submission would overwrite where this person really lives.
    await recordContactEvent({
      email: "tzprojection@example.com",
      phone: "617-650-4548",
      source: "newsletter",
      businessId: BIZ,
    })

    const contactSelects = state.selects.filter((s) => s.table === "contacts")
    expect(contactSelects).toHaveLength(2)
    for (const sel of contactSelects) {
      expect(sel.columns).toContain("timezone")
    }
  })
})

// The register route's half of G04: a person who already exists as a lead
// (or as several leads, one per business) and then makes an account.
describe("linkContactsToUser", () => {
  it("fills user_id on every unlinked contact carrying that email and reports how many", async () => {
    state.rows.push({ id: "c-biz-a", business_id: "biz-a", email: "jordan@example.com", user_id: null })
    state.rows.push({ id: "c-biz-b", business_id: "biz-b", email: "jordan@example.com", user_id: null })
    state.rows.push({ id: "c-other", business_id: "biz-a", email: "someone@else.com", user_id: null })

    const linked = await linkContactsToUser({ email: "Jordan@Example.com", userId: "user-j" })

    expect(linked).toBe(2)
    expect(state.rows.find((r) => r.id === "c-biz-a").user_id).toBe("user-j")
    expect(state.rows.find((r) => r.id === "c-biz-b").user_id).toBe("user-j")
    expect(state.rows.find((r) => r.id === "c-other").user_id).toBeNull()
  })

  it("leaves a contact already linked to someone else alone", async () => {
    state.rows.push({ id: "c-taken", business_id: "biz-a", email: "jordan@example.com", user_id: "user-first" })

    const linked = await linkContactsToUser({ email: "jordan@example.com", userId: "user-j" })

    expect(linked).toBe(0)
    expect(state.rows.find((r) => r.id === "c-taken").user_id).toBe("user-first")
  })

  it("does nothing without a usable email", async () => {
    state.rows.push({ id: "c-x", business_id: "biz-a", email: null, phone_e164: "+16176504548", user_id: null })

    expect(await linkContactsToUser({ email: "   ", userId: "user-j" })).toBe(0)
    expect(state.rows[0].user_id).toBeNull()
  })

  it("throws when the update fails — the register route decides what to do with that", async () => {
    state.errors.contactsUpdate = new Error("link boom")

    await expect(linkContactsToUser({ email: "jordan@example.com", userId: "user-j" })).rejects.toThrow("link boom")
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
