// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: {
  rows: any[]
  timelineEvents: any[]
  consents: any[]
  suppressions: any[]
  sequences: any[]
  sequenceRuns: any[]
} = { rows: [], timelineEvents: [], consents: [], suppressions: [], sequences: [], sequenceRuns: [] }

function collectionFor(table: string): any[] {
  if (table === "contacts") return state.rows
  if (table === "contact_timeline_events") return state.timelineEvents
  if (table === "contact_consents") return state.consents
  if (table === "contact_suppressions") return state.suppressions
  if (table === "sequences") return state.sequences
  if (table === "sequence_runs") return state.sequenceRuns
  return []
}

// Same shape as __tests__/db/contacts-record-event.test.ts's mock: two
// chained .eq() calls are ANDed against a table's backing collection, and
// the whole builder is awaited directly (real PostgREST chaining), rather
// than returning every row regardless of the query.
function makeTable(table: string) {
  const filters: Record<string, any> = {}

  function filterRows() {
    return collectionFor(table).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value))
  }

  const api: any = {
    select() {
      return api
    },
    eq(field: string, value: any) {
      filters[field] = value
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
      if (table === "contact_timeline_events") {
        const row = { id: `evt-${state.timelineEvents.length + 1}`, ...payload }
        state.timelineEvents.push(row)
        return { data: row, error: null }
      }
      if (table === "contact_consents") {
        const row = { id: `consent-${state.consents.length + 1}`, ...payload }
        state.consents.push(row)
        return { data: row, error: null }
      }
      if (table === "contact_suppressions") {
        // Mirrors the real unique index on (business_id, identifier)
        // (supabase/migrations/00215_lead_engine_consent.sql) so
        // suppress()'s 23505-swallow path is exercised the same way it is
        // against real Postgres.
        const dup = state.suppressions.find(
          (r) => r.business_id === payload.business_id && r.identifier === payload.identifier,
        )
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key value" } }
        const row = { id: `sup-${state.suppressions.length + 1}`, ...payload }
        state.suppressions.push(row)
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
          const rows = collectionFor(table)
          for (let i = 0; i < rows.length; i++) {
            if (rows[i][field] === value) rows[i] = { ...rows[i], ...patch }
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
    rpc: async () => ({ data: null, error: null }),
  }),
}))

import {
  importGhlContact,
  findEmailConsentEvidence,
  EMAIL_CONSENT_TAG_ALLOWLIST,
  type GhlContactRecord,
} from "@/lib/lead-engine/import"

const SNAPSHOT = "2026-08-17T02:41:39.000Z"
const BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

// Shape scrubbed from real ghl-export/2026-08-17T02-41-39/contacts.json
// records (id format, field set, null-vs-empty conventions) — values below
// are fabricated, not real contact data.
function baseRecord(overrides: Partial<GhlContactRecord> = {}): GhlContactRecord {
  return {
    id: "cMTAbWGX0sOL2ZCJcp2A",
    email: null,
    phone: null,
    firstName: "Dan",
    lastName: "Harrison",
    contactName: "Dan Harrison",
    dnd: false,
    dndSettings: {},
    tags: [],
    source: null,
    dateAdded: "2026-08-13T18:52:52.140Z",
    ...overrides,
  }
}

beforeEach(() => {
  state.rows = []
  state.timelineEvents = []
  state.consents = []
  state.suppressions = []
  state.sequences = []
  state.sequenceRuns = []
  vi.clearAllMocks()
})

describe("importGhlContact", () => {
  it("skips a record with neither email nor phone, and touches nothing", async () => {
    const out = await importGhlContact(baseRecord({ email: null, phone: null }), { snapshotTimestamp: SNAPSHOT })

    expect(out).toEqual({
      kind: "skipped_no_identifier",
      contactId: null,
      emailConsentImported: false,
      smsRepermissionCandidate: false,
    })
    expect(state.rows).toHaveLength(0)
    expect(state.timelineEvents).toHaveLength(0)
    expect(state.suppressions).toHaveLength(0)
    expect(state.consents).toHaveLength(0)
  })

  it("reports created on the first sighting of an identifier", async () => {
    const out = await importGhlContact(baseRecord({ email: "first-time@example.com" }), {
      snapshotTimestamp: SNAPSHOT,
    })

    expect(out.kind).toBe("created")
    expect(out.contactId).toBeTruthy()
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].email).toBe("first-time@example.com")
  })

  describe("dnd === true", () => {
    it("suppresses both identifiers, with reason ghl_dnd_import, and creates no contact", async () => {
      const record = baseRecord({ email: "dnd-contact@example.com", phone: "+16175550123", dnd: true })

      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out).toEqual({
        kind: "suppressed_only",
        contactId: null,
        emailConsentImported: false,
        smsRepermissionCandidate: false,
      })
      expect(state.rows).toHaveLength(0)
      expect(state.timelineEvents).toHaveLength(0)
      expect(state.consents).toHaveLength(0)
      expect(state.suppressions).toHaveLength(2)
      expect(state.suppressions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            business_id: BUSINESS_ID,
            identifier: "dnd-contact@example.com",
            reason: "ghl_dnd_import",
          }),
          expect.objectContaining({
            business_id: BUSINESS_ID,
            identifier: "+16175550123",
            reason: "ghl_dnd_import",
          }),
        ]),
      )
    })

    it("suppresses only the identifier the record actually has", async () => {
      const record = baseRecord({ email: "onlyemail@example.com", phone: null, dnd: true })

      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out.kind).toBe("suppressed_only")
      expect(state.suppressions).toHaveLength(1)
      expect(state.suppressions[0].identifier).toBe("onlyemail@example.com")
    })

    it("suppressing the same dnd record twice does not throw or duplicate", async () => {
      const record = baseRecord({ email: "repeat-dnd@example.com", dnd: true })

      await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })
      await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(state.suppressions).toHaveLength(1)
    })
  })

  describe("email consent — no documented evidence", () => {
    it("imports zero consent rows against the real (empty) allowlist, even for a tagged record", async () => {
      const record = baseRecord({
        email: "tagged@example.com",
        tags: ["newsletter", "subscriber", "questionnaire-completed", "purchased"],
      })

      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out.emailConsentImported).toBe(false)
      expect(state.consents).toHaveLength(0)
    })

    it("imports zero consent rows for an untagged record", async () => {
      const out = await importGhlContact(baseRecord({ email: "untagged@example.com" }), {
        snapshotTimestamp: SNAPSHOT,
      })

      expect(out.emailConsentImported).toBe(false)
      expect(state.consents).toHaveLength(0)
    })
  })

  describe("email consent — positive evidence path", () => {
    // The real allowlist (EMAIL_CONSENT_TAG_ALLOWLIST) is empty and
    // readonly — the finding this task reports is that nothing in
    // tags.json documents consent, and nothing in this file should ever be
    // able to mutate the shipped default. This block proves the WIRING for
    // when the allowlist isn't empty by passing a synthetic one through
    // `ctx.emailConsentTagAllowlist`, which importGhlContact prefers over
    // the module constant when supplied.
    it("records a consent row citing the matched tag, with wording_shown = the documented citation shape", async () => {
      const record = baseRecord({ email: "opted-in@example.com", tags: ["verified-opt-in"] })

      const out = await importGhlContact(record, {
        snapshotTimestamp: SNAPSHOT,
        emailConsentTagAllowlist: ["verified-opt-in"],
      })

      expect(out.emailConsentImported).toBe(true)
      expect(state.consents).toHaveLength(1)
      const row = state.consents[0]
      expect(row.channel).toBe("email")
      expect(row.granted).toBe(true)
      expect(row.source).toBe("ghl_import")
      expect(row.contact_id).toBe(out.contactId)
      expect(JSON.parse(row.wording_shown)).toEqual({
        ghl_field: "tags",
        value: "verified-opt-in",
        snapshot: SNAPSHOT,
      })
    })

    it("does not record consent when the record has no email to attach it to", async () => {
      const record = baseRecord({ email: null, phone: "+16175550188", tags: ["verified-opt-in"] })

      const out = await importGhlContact(record, {
        snapshotTimestamp: SNAPSHOT,
        emailConsentTagAllowlist: ["verified-opt-in"],
      })

      expect(out.emailConsentImported).toBe(false)
      expect(state.consents).toHaveLength(0)
    })

    it("skips the consent write (defence in depth) when the email is already suppressed, even with matching evidence", async () => {
      state.suppressions.push({
        id: "sup-pre-existing",
        business_id: BUSINESS_ID,
        identifier: "already-suppressed@example.com",
        reason: "unsubscribed",
      })
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      const record = baseRecord({ email: "already-suppressed@example.com", tags: ["verified-opt-in"] })
      const out = await importGhlContact(record, {
        snapshotTimestamp: SNAPSHOT,
        emailConsentTagAllowlist: ["verified-opt-in"],
      })

      expect(out.emailConsentImported).toBe(false)
      expect(state.consents).toHaveLength(0)
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      expect(String(consoleWarnSpy.mock.calls[0][0])).toContain("already suppressed")

      consoleWarnSpy.mockRestore()
    })
  })

  describe("findEmailConsentEvidence (pure matcher)", () => {
    it("cites the matched tag against a supplied allowlist", () => {
      expect(findEmailConsentEvidence(["newsletter", "subscriber"], ["subscriber"])).toEqual({
        ghl_field: "tags",
        value: "subscriber",
      })
    })

    it("returns null when nothing on the record matches the supplied allowlist", () => {
      expect(findEmailConsentEvidence(["newsletter"], ["subscriber"])).toBeNull()
    })

    it("finds nothing against the real default allowlist, because it is empty", () => {
      expect(EMAIL_CONSENT_TAG_ALLOWLIST).toEqual([])
      expect(findEmailConsentEvidence(["newsletter", "subscriber", "purchased", "questionnaire-completed"])).toBeNull()
    })
  })

  describe("phone → sms_repermission_candidate", () => {
    it("flags a phone-bearing record on the timeline and in the outcome", async () => {
      const record = baseRecord({ id: "phone-record-1", phone: "+16175550199" })

      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out.smsRepermissionCandidate).toBe(true)
      const candidateEvents = state.timelineEvents.filter((e) => e.kind === "sms_repermission_candidate")
      expect(candidateEvents).toHaveLength(1)
      expect(candidateEvents[0].contact_id).toBe(out.contactId)
      expect(candidateEvents[0].metadata).toEqual({ ghl_id: "phone-record-1" })
    })

    it("does not flag a phoneless record", async () => {
      const out = await importGhlContact(baseRecord({ email: "nophonehere@example.com", phone: null }), {
        snapshotTimestamp: SNAPSHOT,
      })

      expect(out.smsRepermissionCandidate).toBe(false)
      expect(state.timelineEvents.some((e) => e.kind === "sms_repermission_candidate")).toBe(false)
    })
  })

  describe("ghl_import provenance", () => {
    it("writes a ghl_import row citing the ghl id, snapshot, and dateAdded for every non-suppressed record", async () => {
      const record = baseRecord({
        id: "provenance-ghl-id",
        email: "provenance@example.com",
        dateAdded: "2026-08-01T12:00:00.000Z",
      })

      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      const importEvents = state.timelineEvents.filter((e) => e.kind === "ghl_import")
      expect(importEvents).toHaveLength(1)
      expect(importEvents[0].contact_id).toBe(out.contactId)
      expect(importEvents[0].source).toBe("ghl_import")
      expect(importEvents[0].metadata).toEqual({
        ghl_id: "provenance-ghl-id",
        snapshot: SNAPSHOT,
        date_added: "2026-08-01T12:00:00.000Z",
      })
    })

    it("scopes idempotency to THIS business — a ghl_import row logged under a different business_id does not suppress the write", async () => {
      // A foreign business's history sharing this contact_id and ghl_id
      // (unrealistic in this singleton-business app today, but the query
      // must not rely on that — it filters business_id explicitly).
      state.rows.push({
        id: "scoped-contact",
        business_id: BUSINESS_ID,
        email: "scoped@example.com",
        phone_e164: null,
        created_at: "2020-01-01T00:00:00Z",
      })
      state.timelineEvents.push({
        id: "foreign-business-evt",
        business_id: "11111111-1111-1111-1111-111111111111",
        contact_id: "scoped-contact",
        kind: "ghl_import",
        source: "ghl_import",
        metadata: { ghl_id: "scoped-ghl-id", snapshot: SNAPSHOT, date_added: "2020-01-01T00:00:00.000Z" },
      })

      const record = baseRecord({ id: "scoped-ghl-id", email: "scoped@example.com" })
      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out.kind).toBe("enriched")
      const ownBusinessImportRows = state.timelineEvents.filter(
        (e) => e.kind === "ghl_import" && e.contact_id === "scoped-contact" && e.business_id === BUSINESS_ID,
      )
      expect(ownBusinessImportRows).toHaveLength(1)
    })
  })

  describe("re-run idempotency", () => {
    it("enriches (not duplicates) the contact, and writes exactly one ghl_import row for the same ghl id", async () => {
      const record = baseRecord({ id: "repeat-ghl-id", email: "repeat@example.com" })

      const first = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })
      const second = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(first.kind).toBe("created")
      expect(second.kind).toBe("enriched")
      expect(second.contactId).toBe(first.contactId)
      expect(state.rows).toHaveLength(1)

      const importEvents = state.timelineEvents.filter(
        (e) => e.kind === "ghl_import" && e.metadata?.ghl_id === "repeat-ghl-id",
      )
      expect(importEvents).toHaveLength(1)
    })

    it("does not resurrect a ghl_import row for a DIFFERENT ghl id landing on the same contact", async () => {
      const first = await importGhlContact(baseRecord({ id: "ghl-id-a", email: "shared-person@example.com" }), {
        snapshotTimestamp: SNAPSHOT,
      })
      const second = await importGhlContact(baseRecord({ id: "ghl-id-b", email: "shared-person@example.com" }), {
        snapshotTimestamp: SNAPSHOT,
      })

      expect(second.contactId).toBe(first.contactId)
      const importEvents = state.timelineEvents.filter((e) => e.kind === "ghl_import")
      expect(importEvents).toHaveLength(2)
      expect(importEvents.map((e) => e.metadata.ghl_id).sort()).toEqual(["ghl-id-a", "ghl-id-b"])
    })

    // The idempotency check used to run per-write-kind: only ghl_import was
    // deduped, so identifier_conflict, sms_repermission_candidate, and (had
    // the allowlist ever been non-empty) consent rows all duplicated on
    // every re-run. The fix hoists ONE alreadyLoggedImport check above every
    // write and early-returns — this test is the record-level guarantee
    // that fix makes: not just "ghl_import doesn't duplicate" but "nothing
    // does".
    it("writes ZERO new rows of any kind on a second run of the same record", async () => {
      const record = baseRecord({
        id: "full-idempotent-ghl-id",
        email: "full-idempotent@example.com",
        phone: "+16175550166",
      })

      const first = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      const rowsAfterFirst = state.rows.length
      const timelineAfterFirst = state.timelineEvents.length
      const consentsAfterFirst = state.consents.length
      const suppressionsAfterFirst = state.suppressions.length
      expect(timelineAfterFirst).toBeGreaterThan(0) // sanity: the first run actually wrote something

      const second = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(second.kind).toBe("enriched")
      expect(second.contactId).toBe(first.contactId)
      expect(second.smsRepermissionCandidate).toBe(true)
      expect(second.emailConsentImported).toBe(false)
      expect(state.rows).toHaveLength(rowsAfterFirst)
      expect(state.timelineEvents).toHaveLength(timelineAfterFirst)
      expect(state.consents).toHaveLength(consentsAfterFirst)
      expect(state.suppressions).toHaveLength(suppressionsAfterFirst)
    })
  })

  describe("merged — threaded from upsertContactIdentity", () => {
    it("reports merged: false on a plain create", async () => {
      const out = await importGhlContact(baseRecord({ email: "plain-create@example.com" }), {
        snapshotTimestamp: SNAPSHOT,
      })

      expect(out.merged).toBe(false)
    })

    it("reports merged: true when the import resolves email and phone to two different existing contacts", async () => {
      state.rows.push(
        {
          id: "older-contact",
          business_id: BUSINESS_ID,
          email: "merge-target@example.com",
          phone_e164: null,
          created_at: "2020-01-01T00:00:00Z",
        },
        {
          id: "newer-contact",
          business_id: BUSINESS_ID,
          email: null,
          phone_e164: "+16175550177",
          created_at: "2024-01-01T00:00:00Z",
        },
      )

      const record = baseRecord({ email: "merge-target@example.com", phone: "+16175550177" })
      const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(out.merged).toBe(true)
      expect(out.contactId).toBe("older-contact")
    })
  })

  it("preserves a conflicting identifier on the timeline instead of overwriting it", async () => {
    state.rows.push({
      id: "existing-contact",
      business_id: BUSINESS_ID,
      email: "conflict@example.com",
      phone_e164: "+16175551111",
      created_at: "2020-01-01T00:00:00Z",
    })

    const record = baseRecord({ email: "conflict@example.com", phone: "+16175559888" })
    const out = await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

    expect(out.contactId).toBe("existing-contact")
    expect(out.kind).toBe("enriched")
    const row = state.rows.find((r) => r.id === "existing-contact")
    expect(row.phone_e164).toBe("+16175551111")

    const conflictEvents = state.timelineEvents.filter((e) => e.kind === "identifier_conflict")
    expect(conflictEvents).toHaveLength(1)
    expect(conflictEvents[0].contact_id).toBe("existing-contact")
    expect(conflictEvents[0].metadata).toMatchObject({
      field: "phone",
      submitted: "+16175559888",
      existing: "+16175551111",
    })
  })

  // The load-bearing property: an import must NEVER be able to fire
  // marketing at someone just because their historical record happens to
  // match an active sequence's trigger. Proven two ways — this direct
  // assertion, plus a mutation test (documented in task-7-report.md) that
  // temporarily routes the identity call through recordContactEvent instead
  // of upsertContactIdentity and confirms THIS test fails when it does.
  describe("an import can NEVER create a sequence run", () => {
    it("leaves sequence_runs untouched even with an ACTIVE matching-source sequence present", async () => {
      state.sequences.push({
        id: "seq-active",
        business_id: BUSINESS_ID,
        status: "active",
        trigger_source: "inquiry",
        trigger_filter: {},
      })

      const record = baseRecord({ email: "would-be-enrolled@example.com" })
      await importGhlContact(record, { snapshotTimestamp: SNAPSHOT })

      expect(state.sequenceRuns).toHaveLength(0)
    })
  })
})
