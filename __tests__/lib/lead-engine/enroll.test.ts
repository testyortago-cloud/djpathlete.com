// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

type Row = Record<string, any>

const store: { sequences: Row[]; sequence_runs: Row[]; contact_timeline_events: Row[] } = {
  sequences: [],
  sequence_runs: [],
  contact_timeline_events: [],
}

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

// Every `.eq()` the implementation applies, across every `from()` chain in a
// test. The per-chain `filters` array below narrows the row set, which proves
// a filter was USED; this one records WHICH VALUE it was given, which is a
// different claim and the one the tenancy test needs.
let appliedEqs: Array<[string, any]> = []

/**
 * When set, a `sequence_runs` insert whose payload names this column is
 * refused the way PostgREST refuses a column it does not know about. Reset to
 * null in `beforeEach`, so it is opt-in per test. See `doInsert`.
 */
let missingColumnOnInsert: string | null = null

/**
 * When set, EVERY `sequence_runs` insert is refused with this error. Used to
 * pin that the deploy-race retry fires for a missing column and for nothing
 * else — see `runInsertPayloads`.
 */
let insertRunError: { code: string; message: string } | null = null

/**
 * Every payload handed to a `sequence_runs` insert, in order, including the
 * ones that were refused. The COUNT is the assertion that matters: a retry
 * that fires for the wrong reason is invisible in the resulting rows (the
 * second attempt fails the same way) and visible only here.
 */
let runInsertPayloads: Row[] = []

/**
 * How many times each table was READ. G14 adds two queries to a path that
 * runs on every lead capture, and skips both when no sequence matches the
 * source — a saving that is invisible in the resulting rows and visible
 * only by counting.
 */
let readsByTable: Record<string, number> = {}

// NOTE ON THE MOCK: the trap this project has hit before is a `.eq()` that
// returns the query object without recording the filter, so every query
// resolves to "everything in the table" and every assertion passes without
// ever exercising the real filtering logic (see __tests__/db/contact-consents.test.ts
// and __tests__/db/sequences.test.ts for the prior write-ups). This mock
// tracks every applied `.eq()` filter and narrows the row set for real. It
// also enforces the same partial-unique-index conflict
// (sequence_runs_one_active_per_sequence: business_id, sequence_id,
// contact_id WHERE status = 'active') that migration 00216 puts on the real
// table, so the 23505 path is exercised against realistic conflict logic,
// not a stub.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: "sequences" | "sequence_runs" | "contact_timeline_events") => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      let mode: "select" | "insert" | "update" = "select"
      let payload: Row | null = null
      let ordered: { column: string; ascending: boolean } | null = null

      // `.in(col, values)` narrows for real, same as `.eq` — `describeSequences`
      // reads the blocking runs' sequences this way, and a no-op `in` would
      // hand every sequence back and make the manual-only exemption look
      // like it worked when it had not been exercised at all.
      const inFilters: Array<[string, any[]]> = []

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) && inFilters.every(([col, vals]) => vals.includes(row[col]))

      const doSelect = () => {
        readsByTable[table] = (readsByTable[table] ?? 0) + 1
        const matched = rows.filter(passesFilters)
        if (ordered) {
          const { column, ascending } = ordered
          matched.sort((a, b) => {
            const av = a[column] ?? ""
            const bv = b[column] ?? ""
            if (av === bv) return 0
            return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
          })
        }
        return { data: matched, error: null }
      }

      // G14. `exitRun` (lib/db/sequences.ts) is `.update({...}).eq("id", …)`,
      // so the supersede path is unreachable without this. Mutates the SAME
      // row objects the store holds, exactly as the database would, which is
      // what lets a later assertion read the status back off `store`.
      const doUpdate = () => {
        const p = payload as Row
        const matched = rows.filter(passesFilters)
        for (const row of matched) Object.assign(row, p)
        return { data: matched, error: null }
      }

      const doInsert = () => {
        const p = payload as Row
        if (table === "sequence_runs") {
          runInsertPayloads.push(p)
          // G10 deploy race. Mirrors PostgREST's refusal when the payload
          // names a column its schema cache has never seen — which is what
          // this code meets for the minutes between the Vercel build going
          // live and migration 00266 applying. Set by the test that pins the
          // fallback; every other test leaves it null, so a column named on a
          // schema that HAS it inserts normally.
          if (missingColumnOnInsert !== null && Object.prototype.hasOwnProperty.call(p, missingColumnOnInsert)) {
            const err: any = new Error(
              `Could not find the '${missingColumnOnInsert}' column of 'sequence_runs' in the schema cache`,
            )
            err.code = "PGRST204"
            return { data: null, error: err }
          }
          if (insertRunError !== null) {
            const err: any = new Error(insertRunError.message)
            err.code = insertRunError.code
            return { data: null, error: err }
          }
          const conflict = rows.find(
            (r) =>
              r.business_id === p.business_id &&
              r.sequence_id === p.sequence_id &&
              r.contact_id === p.contact_id &&
              r.status === "active",
          )
          if (conflict) {
            const err: any = new Error(
              'duplicate key value violates unique constraint "sequence_runs_one_active_per_sequence"',
            )
            err.code = "23505"
            // Real Postgres embeds the identifying values in `details` — not
            // exercised by identity here, but kept absent from `code`/`message`
            // deliberately, matching the production PII contract.
            err.details = `Key (business_id, sequence_id, contact_id)=(${p.business_id}, ${p.sequence_id}, ${p.contact_id}) already exists.`
            return { data: null, error: err }
          }
        }
        const row: Row = {
          id: p.id ?? nextId(table),
          status: p.status ?? "active",
          created_at: new Date().toISOString(),
          ...p,
        }
        rows.push(row)
        return { data: row, error: null }
      }

      const execute = () => (mode === "insert" ? doInsert() : mode === "update" ? doUpdate() : doSelect())

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val])
          appliedEqs.push([col, val])
          return api
        },
        order: (column: string, opts?: { ascending?: boolean }) => {
          ordered = { column, ascending: opts?.ascending !== false }
          return api
        },
        in: (col: string, vals: any[]) => {
          inFilters.push([col, vals])
          return api
        },
        insert: (p: Row) => {
          mode = "insert"
          payload = p
          return execute()
        },
        // Returns `api`, not the result: `exitRun` chains `.eq()` after the
        // update and awaits the chain, so the write must not fire until the
        // filters are in.
        update: (p: Row) => {
          mode = "update"
          payload = p
          return api
        },
        // Added for enrolContactManually's `.select(...).eq(...).eq(...).maybeSingle()`
        // lookup of a sequence by key — same pattern as
        // __tests__/db/sequences.test.ts's maybeSingle mock.
        maybeSingle: async () => {
          const { data, error } = execute()
          if (error) return { data: null, error }
          const arr: Row[] = Array.isArray(data) ? data : data ? [data] : []
          return { data: arr[0] ?? null, error: null }
        },
        then: (resolve: (v: { data: any; error: any }) => void, reject?: (e: any) => void) => {
          try {
            resolve(execute())
          } catch (e) {
            if (reject) reject(e)
            else throw e
          }
        },
      }
      return api
    },
  }),
}))

import { enrollIfTriggered, enrolContactManually, SUPERSEDING_SOURCES } from "@/lib/lead-engine/enroll"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

function seedSequence(id: string, overrides: Partial<Row> = {}) {
  store.sequences.push({
    id,
    business_id: SINGLETON_BUSINESS_ID,
    key: `seq-${id}`,
    name: "Seq",
    trigger_source: "funnel_form",
    trigger_filter: {},
    status: "active",
    ...overrides,
  })
}

beforeEach(() => {
  store.sequences = []
  store.sequence_runs = []
  store.contact_timeline_events = []
  seqCounter = 0
  appliedEqs = []
  missingColumnOnInsert = null
  insertRunError = null
  runInsertPayloads = []
  readsByTable = {}
})

// NOT the platform id, and not what `seedSequence` stamps. Every other call in
// this file passes SINGLETON_BUSINESS_ID into fixtures seeded under
// SINGLETON_BUSINESS_ID, so a DAL that ignored its argument and hard-coded the
// constant would satisfy all of them: they pin the ARITY of the tenant
// parameter, not the value it carries.
const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

describe("enrollIfTriggered", () => {
  // RETARGETED by G14, not deleted. This used to read "enrols into EVERY
  // active sequence whose trigger matches", and that is precisely the
  // behaviour the owner's option-B decision reverses: one event now enrols
  // into at most one sequence. What is still worth pinning is everything
  // else it pinned — that the right sequences are considered, that a
  // different source is not, and the shape of the row that gets written.
  it("enrols into ONE matching sequence and writes a complete run row", async () => {
    seedSequence("seq-a", { trigger_source: "funnel_form", key: "aaa" })
    seedSequence("seq-b", { trigger_source: "funnel_form", key: "bbb" })
    seedSequence("seq-c", { trigger_source: "newsletter", key: "ccc" })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      businessId: SINGLETON_BUSINESS_ID,
    })

    // `seq-a` by key order, and `seq-c` never considered at all — a
    // newsletter sequence must not be reachable from a funnel_form event.
    expect(result.enrolled).toEqual(["seq-a"])
    expect(store.sequence_runs).toHaveLength(1)
    const run = store.sequence_runs[0]
    expect(run.sequence_id).toBe("seq-a")
    expect(run.contact_id).toBe("contact-1")
    expect(run.business_id).toBe(SINGLETON_BUSINESS_ID)
    expect(run.current_position).toBe(0)
    expect(run.next_run_at).toBeTruthy()
  })

  it("ignores draft, paused and archived sequences", async () => {
    seedSequence("seq-draft", { status: "draft" })
    seedSequence("seq-paused", { status: "paused" })
    seedSequence("seq-archived", { status: "archived" })
    seedSequence("seq-active", { status: "active" })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual(["seq-active"])
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].sequence_id).toBe("seq-active")
  })

  it("ignores sequences whose trigger_source is null", async () => {
    seedSequence("seq-null-trigger", { trigger_source: null, status: "active" })
    seedSequence("seq-matching", { trigger_source: "funnel_form", status: "active" })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual(["seq-matching"])
  })

  it("treats a duplicate-run 23505 as already-enrolled, not an error", async () => {
    seedSequence("seq-a", { trigger_source: "funnel_form" })
    store.sequence_runs.push({
      id: "existing-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-a",
      contact_id: "contact-1",
      status: "active",
      current_position: 0,
    })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual([])
    // No new row was inserted — the one already there is untouched.
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].id).toBe("existing-run")
  })

  // RETARGETED by G14. The point — a 23505 on one candidate must not abort
  // the loop — still stands, but the old setup used `funnel_form`, which no
  // longer reaches a second candidate at all once the contact has an active
  // run (that is the new rule working, not a regression). `quiz` supersedes,
  // so the second candidate is legitimately reachable and the original
  // assertion survives intact.
  it("continues to the next sequence after swallowing a 23505 on an earlier one", async () => {
    seedSequence("seq-dup", { trigger_source: "quiz", key: "aaa" })
    seedSequence("seq-new", { trigger_source: "quiz", key: "bbb" })
    store.sequence_runs.push({
      id: "existing-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-dup",
      contact_id: "contact-1",
      status: "active",
      current_position: 0,
    })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "quiz",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual(["seq-new"])
    expect(store.sequence_runs).toHaveLength(2)
    // And `seq-dup`'s run is NOT superseded, even though `seq-new` enrolled
    // afterwards. This same event matched `seq-dup` — it is only not
    // enrolling because they are already in it — so moving them out of it
    // would be one event both putting somebody in a sequence and taking
    // them out of it. Review finding; the first cut asserted the opposite.
    const dup = store.sequence_runs.find((r) => r.id === "existing-run")
    expect(dup?.status).toBe("active")
    expect(dup?.exit_reason).toBeUndefined()
  })

  it("applies trigger_filter against the event metadata", async () => {
    seedSequence("seq-filtered", { trigger_filter: { funnel_id: "abc" } })
    seedSequence("seq-open", { trigger_filter: {} })

    const mismatch = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      metadata: { funnel_id: "xyz" },
      businessId: SINGLETON_BUSINESS_ID,
    })
    // The filtered sequence does not match; the empty-filter one always does.
    expect(mismatch.enrolled).toEqual(["seq-open"])

    store.sequences = []
    store.sequence_runs = []
    seedSequence("seq-filtered", { trigger_filter: { funnel_id: "abc" } })

    const match = await enrollIfTriggered({
      contactId: "contact-2",
      source: "funnel_form",
      metadata: { funnel_id: "abc", unrelated: "ignored" },
      businessId: SINGLETON_BUSINESS_ID,
    })
    expect(match.enrolled).toEqual(["seq-filtered"])
  })

  // Lead Engine Stage 4, Task 5 (spec §4, "shop checkout" row): "NO sequence
  // rides purchase in this stage" — a deliberate design choice, not an
  // accident of no sequence having been seeded yet. Proven here against the
  // real mechanism rather than only asserted in the Stripe webhook's own
  // spine test (__tests__/api/spine/purchase-spine.test.ts), which mocks
  // recordContactEvent — and therefore enrollIfTriggered itself — away.
  it("does not enrol a 'purchase' source into a sequence triggered by a different source", async () => {
    seedSequence("seq-newsletter", { trigger_source: "newsletter" })

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "purchase",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual([])
    expect(store.sequence_runs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// enrolContactManually — Task 9's manual-only enrolment path. Every
// `sms_repermission`-shaped sequence in these tests has `trigger_source:
// null` and is looked up BY KEY, matching how migration 00223 seeds it and
// how scripts/enrol-repermission.ts will call this function.
// ---------------------------------------------------------------------------

describe("enrolContactManually", () => {
  it("enrols a contact into a named active manual sequence", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    const result = await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "enrolled" })
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0]).toMatchObject({
      sequence_id: "seq-repermission",
      contact_id: "contact-1",
      business_id: SINGLETON_BUSINESS_ID,
      current_position: 0,
    })
  })

  // The active-sequence check: migration 00223 seeds sms_repermission as
  // 'draft' on purpose (the "ships loaded, safety on" contract — see the
  // migration's own header). Nothing may enrol into it until a human runs
  // scripts/activate-sequence.mjs.
  it("refuses to enrol into a draft sequence", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "draft" })

    const result = await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "sequence_not_active", status: "draft" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  it("refuses to enrol into a paused or archived sequence the same way", async () => {
    seedSequence("seq-paused", { key: "seq-paused-key", trigger_source: null, status: "paused" })

    const result = await enrolContactManually("contact-1", "seq-paused-key", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "sequence_not_active", status: "paused" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  it("reports sequence_not_found for an unknown key rather than silently no-oping", async () => {
    const result = await enrolContactManually("contact-1", "does-not-exist", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "sequence_not_found" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  // WHICH tenant, not just that one was passed. The sequence below exists —
  // under the platform business — and the key is right, so the only thing that
  // can make this lookup miss is the business filter carrying the ARGUMENT
  // rather than the constant.
  it("looks the sequence up under the business it was given, not the platform's", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    const result = await enrolContactManually("contact-1", "sms_repermission", { businessId: OTHER_BUSINESS_ID })

    expect(result).toEqual({ outcome: "sequence_not_found" })
    expect(store.sequence_runs).toHaveLength(0)
    // Presence control: "not found" is also what a mock that ignored the
    // filter and a query that never ran would both produce. This pins that the
    // business filter WAS applied, and which value it carried.
    expect(appliedEqs).toContainEqual(["business_id", OTHER_BUSINESS_ID])
  })

  // The duplicate-run guard: a second manual enrolment of the same contact
  // into the same sequence must no-op, not create a second sequence_runs
  // row and not throw. This is the exact mechanism
  // scripts/enrol-repermission.ts relies on to be safely re-runnable.
  it("no-ops on a second enrolment of the same contact into the same sequence", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    const first = await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })
    const second = await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })

    expect(first).toEqual({ outcome: "enrolled" })
    expect(second).toEqual({ outcome: "already_enrolled" })
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("still enrols a different contact into the same sequence after a duplicate no-op", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })
    const result = await enrolContactManually("contact-2", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "enrolled" })
    expect(store.sequence_runs).toHaveLength(2)
  })

  // ONE-PER-CONTACT-EVER (Task 9 review, Finding 1): the partial unique
  // index (sequence_runs_one_active_per_sequence, migration 00216) is
  // scoped WHERE status = 'active', so a COMPLETED or EXITED prior run does
  // NOT trip the ordinary duplicate-run guard above — that guard only fires
  // on the insert's own 23505, and a completed/exited row is not "active"
  // as far as that index cares. `onePerContact: true` is the separate check
  // for exactly this gap, load-bearing for a true one-shot ask like
  // sms_repermission ("one ask, then stop" — migration 00223's own header).
  it("refuses a second enrolment against a COMPLETED prior run when onePerContact is true", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })
    store.sequence_runs.push({
      id: "prior-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-repermission",
      contact_id: "contact-1",
      status: "completed",
      current_position: 1,
    })

    const result = await enrolContactManually("contact-1", "sms_repermission", {
      businessId: SINGLETON_BUSINESS_ID,
      onePerContact: true,
    })

    expect(result).toEqual({ outcome: "already_enrolled_once" })
    // Nothing new was inserted — the prior (completed) row is the only one.
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("refuses a second enrolment against an EXITED prior run when onePerContact is true", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })
    store.sequence_runs.push({
      id: "prior-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-repermission",
      contact_id: "contact-1",
      status: "exited",
      current_position: 0,
    })

    const result = await enrolContactManually("contact-1", "sms_repermission", {
      businessId: SINGLETON_BUSINESS_ID,
      onePerContact: true,
    })

    expect(result).toEqual({ outcome: "already_enrolled_once" })
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("allows a fresh enrolment against a completed prior run when onePerContact is left at its default (false)", async () => {
    // Proves the default really is false, and that leaving it off is what a
    // legitimate re-engagement-style sequence relies on (see the doc
    // comment on enrolContactManually).
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })
    store.sequence_runs.push({
      id: "prior-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-repermission",
      contact_id: "contact-1",
      status: "completed",
      current_position: 1,
    })

    const result = await enrolContactManually("contact-1", "sms_repermission", { businessId: SINGLETON_BUSINESS_ID })

    expect(result).toEqual({ outcome: "enrolled" })
    expect(store.sequence_runs).toHaveLength(2)
  })

  it("does not confuse a completed run of a DIFFERENT sequence for a prior run of this one", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })
    seedSequence("seq-other", { key: "seq-other-key", trigger_source: null, status: "active" })
    store.sequence_runs.push({
      id: "prior-run-other-sequence",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-other",
      contact_id: "contact-1",
      status: "completed",
      current_position: 1,
    })

    const result = await enrolContactManually("contact-1", "sms_repermission", {
      businessId: SINGLETON_BUSINESS_ID,
      onePerContact: true,
    })

    expect(result).toEqual({ outcome: "enrolled" })
  })
})

// RE-ENROLMENT COOLDOWN. `sequence_runs_one_active_per_sequence` only stops a
// second ACTIVE run; once a run completes or exits, a fresh trigger enrols the
// same contact again immediately. That is how one account holder was put
// through `abandoned_checkout` twice in four days (16 and 19 Sept 2026) — the
// pack payment-link cron re-fires the trigger daily. `sequences.reenrol_cooldown_days`
// (migration 00263; this function is its ONLY reader) says how long a contact
// must be out of a sequence before a trigger may put them back in. Seeded 30;
// 0 for the quiz sequences, whose first email IS the result the person asked
// for, so a retake must still get one.
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function seedPriorRun(
  sequenceId: string,
  status: "completed" | "exited" | "failed" | "active",
  updatedAt: string,
  extra: Record<string, unknown> = {},
) {
  store.sequence_runs.push({
    id: nextId("prior"),
    business_id: SINGLETON_BUSINESS_ID,
    sequence_id: sequenceId,
    contact_id: "contact-1",
    status,
    current_position: 3,
    updated_at: updatedAt,
    ...extra,
  })
}

describe("enrollIfTriggered — re-enrolment cooldown", () => {
  it("refuses to re-enrol a contact whose run of the same sequence COMPLETED inside the cooldown", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "completed", daysAgo(3))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual([])
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("refuses when the prior run EXITED inside the cooldown, too", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "exited", daysAgo(3))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual([])
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("re-enrols once the cooldown has passed", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "completed", daysAgo(31))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-1"])
    expect(store.sequence_runs).toHaveLength(2)
  })

  it("a cooldown of 0 re-enrols straight after a finished run — the quiz sequences", async () => {
    seedSequence("seq-quiz", { trigger_source: "quiz", reenrol_cooldown_days: 0 })
    // Stamped one minute in the FUTURE, deliberately: with the real `> 0`
    // guard the prior runs are never read at all, so this enrols. With the
    // near-equivalent mutant `>= 0` the cutoff is "now", a future timestamp
    // is inside the window, and the run is refused — a `daysAgo(0)` stamp
    // would sit a few milliseconds BEFORE that cutoff and let the mutant
    // pass.
    seedPriorRun("seq-quiz", "completed", new Date(Date.now() + 60_000).toISOString())

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "quiz", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-quiz"])
    expect(store.sequence_runs).toHaveLength(2)
    expect(store.contact_timeline_events).toHaveLength(0)
  })

  it("a FAILED run inside the window does not count — a run that died on a configuration fault must not also lock the person out", async () => {
    // MUTANT this pins: deleting the status check in hasRunFinishedWithin.
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "failed", daysAgo(3))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-1"])
    expect(store.sequence_runs).toHaveLength(2)
    expect(store.contact_timeline_events).toHaveLength(0)
  })

  it("an ACTIVE run is refused by the unique index, not by the cooldown — so no cooldown note is written", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "active", daysAgo(1))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual([])
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.contact_timeline_events).toHaveLength(0)
  })

  it("prefers completed_at over updated_at when both are present", async () => {
    // MUTANT this pins: `run.updated_at ?? run.completed_at`. A run that
    // finished 40 days ago but was touched yesterday is OUT of the window.
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "completed", daysAgo(1), { completed_at: daysAgo(40) })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-1"])
  })

  it("names the refusal on the contact's timeline: which sequence, and how long the cooldown is", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedPriorRun("seq-1", "completed", daysAgo(3))

    await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(store.contact_timeline_events).toHaveLength(1)
    expect(store.contact_timeline_events[0]).toMatchObject({
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "contact-1",
      kind: "enrolment_skipped",
      source: "sequence_engine",
      metadata: { sequence_id: "seq-1", sequence_key: "seq-seq-1", sequence_name: "Seq", reason: "cooldown", cooldown_days: 30 },
    })
  })

  it("writes no timeline row when it enrols normally", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })

    await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(store.contact_timeline_events).toHaveLength(0)
  })

  it("applies the default of 30 days when the sequence row carries no cooldown at all — the old schema, for one deploy", async () => {
    // `seedSequence` sets no `reenrol_cooldown_days`; the row looks exactly
    // like one read before migration 00263 has been applied.
    seedSequence("seq-1")
    seedPriorRun("seq-1", "completed", daysAgo(3))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual([])
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("a prior run of a DIFFERENT sequence does not block this one", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    seedSequence("seq-2", { reenrol_cooldown_days: 30, trigger_source: "newsletter" })
    seedPriorRun("seq-2", "completed", daysAgo(3))

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-1"])
  })

  it("a prior run of ANOTHER contact does not block this one", async () => {
    seedSequence("seq-1", { reenrol_cooldown_days: 30 })
    store.sequence_runs.push({
      id: "someone-elses",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-1",
      contact_id: "contact-2",
      status: "completed",
      current_position: 3,
      updated_at: daysAgo(1),
    })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form", businessId: SINGLETON_BUSINESS_ID })

    expect(result.enrolled).toEqual(["seq-1"])
  })
})

// ---------------------------------------------------------------------------
// G10 — what the run remembers about the event that enrolled it.
//
// `enrolment_metadata` is written by `insertSequenceRun`, the ONE place a run
// row is inserted, so the triggered and the manual paths cannot drift. The
// allow-list itself is tested in isolation in enrolment-metadata.test.ts;
// what is pinned HERE is that the run row actually carries the result, that
// the raw bag never reaches it, and that an enrolment still happens when the
// column does not exist yet.
// ---------------------------------------------------------------------------

describe("enrollIfTriggered — the anchor on the run (G11)", () => {
  const CAMP_STARTS = "2026-07-01T09:00:00.000Z"

  it("records the anchor it was given on the run", async () => {
    seedSequence("seq-a", { trigger_source: "event_signup" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "event_signup",
      metadata: { signup_type: "interest" },
      businessId: SINGLETON_BUSINESS_ID,
      anchorAt: CAMP_STARTS,
    })

    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].anchor_at).toBe(CAMP_STARTS)
  })

  it("leaves the anchor OFF the payload entirely when there is none", async () => {
    // Not `anchor_at: null`. Naming a column is what triggers the missing-
    // column retry, and almost every enrolment in the product has no anchor —
    // sending null would cost the deploy window an extra round trip on every
    // single lead capture, for a value that means nothing.
    seedSequence("seq-a", { trigger_source: "inquiry" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "inquiry",
      metadata: {},
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(runInsertPayloads).toHaveLength(1)
    expect(runInsertPayloads[0]).not.toHaveProperty("anchor_at")
  })

  it("IGNORES an anchor smuggled through the metadata bag", async () => {
    // THE SECURITY CASE, and the reason this is a typed argument at all. On
    // the funnel path `metadata` is the visitor's ENTIRE typed payload and
    // funnel field names are owner-chosen (`^[a-z][a-z0-9_]{0,39}$`), so an
    // owner can name a field `anchor_at` or `event_start_date` and a stranger
    // then types the value. This one decides WHEN mail is sent.
    seedSequence("seq-a", { trigger_source: "funnel_form" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      metadata: { anchor_at: "2030-01-01T00:00:00.000Z", event_start_date: "2030-01-01T00:00:00.000Z" },
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].anchor_at).toBeUndefined()
    expect(runInsertPayloads[0]).not.toHaveProperty("anchor_at")
    // Nor did it reach the metadata column: the allow-list has no such key.
    expect(store.sequence_runs[0].enrolment_metadata).toEqual({})
  })

  it("prefers the typed argument even when the bag names the same key", async () => {
    // Belt and braces on the case above: with BOTH present the typed one
    // wins, so a visitor cannot override a real camp date either.
    seedSequence("seq-a", { trigger_source: "event_signup" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "event_signup",
      metadata: { anchor_at: "2030-01-01T00:00:00.000Z" },
      businessId: SINGLETON_BUSINESS_ID,
      anchorAt: CAMP_STARTS,
    })

    expect(store.sequence_runs[0].anchor_at).toBe(CAMP_STARTS)
  })

  it("still enrols when anchor_at does not exist yet — the one-deploy window", async () => {
    // 00266 and 00267 can reach a database SEPARATELY, so the retry drops
    // BOTH new keys rather than the one the error named. Retrying with the
    // other still present would fail again and throw, turning a tolerated
    // window into lost enrolments.
    seedSequence("seq-a", { trigger_source: "event_signup" })
    missingColumnOnInsert = "anchor_at"

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "event_signup",
      metadata: { service: "camp" },
      businessId: SINGLETON_BUSINESS_ID,
      anchorAt: CAMP_STARTS,
    })

    expect(result.enrolled).toEqual(["seq-a"])
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].anchor_at).toBeUndefined()
    // The run still exists and is usable — that is the whole point.
    expect(store.sequence_runs[0].contact_id).toBe("contact-1")
    expect(store.sequence_runs[0].current_position).toBe(0)
    // Two attempts, and the retry dropped BOTH new keys.
    expect(runInsertPayloads).toHaveLength(2)
    expect(runInsertPayloads[0]).toHaveProperty("anchor_at")
    expect(runInsertPayloads[1]).not.toHaveProperty("anchor_at")
    expect(runInsertPayloads[1]).not.toHaveProperty("enrolment_metadata")
  })
})

describe("enrollIfTriggered — enrolment metadata on the run", () => {
  it("records the allow-listed facts about the enrolling event on the run", async () => {
    seedSequence("seq-a", { trigger_source: "inquiry" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "inquiry",
      metadata: { service: "camp" },
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].enrolment_metadata).toEqual({ service: "camp" })
  })

  it("NEVER stores an email or a phone number, though the funnel path hands it the visitor's whole payload", async () => {
    // This is the row's own acceptance criterion, written as a POSITIVE
    // control: the run is created, it carries the two facts worth keeping,
    // and it carries nothing else. An implementation that stored the raw bag
    // would keep `email` and `parent_phone`; one that stored nothing at all
    // would fail the first assertion instead of passing the second by
    // accident.
    seedSequence("seq-a", { trigger_source: "funnel_form" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      metadata: {
        role: "parent",
        service: "camp",
        email: "parent@example.com",
        parent_email: "parent@example.com",
        parent_phone: "+61 412 345 678",
        notes: "reachable on 0412345678 after 6pm",
        athlete_name: "A Real Child",
      },
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(store.sequence_runs).toHaveLength(1)
    const stored = store.sequence_runs[0].enrolment_metadata
    expect(stored).toEqual({ service: "camp", role: "parent" })
    expect(JSON.stringify(stored)).not.toMatch(/@|\d{7}/)
  })

  it("records an empty object when the event carried nothing worth keeping", async () => {
    seedSequence("seq-a", { trigger_source: "newsletter" })

    await enrollIfTriggered({
      contactId: "contact-1",
      source: "newsletter",
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(store.sequence_runs[0].enrolment_metadata).toEqual({})
  })

  it("still enrols when the column does not exist yet — the one-deploy window", async () => {
    // Migrations and the Vercel build race on merge to main. Unhandled, this
    // window turns every lead capture's enrolment into a swallowed error:
    // the contact is kept (recordContactEvent treats enrolment as non-fatal)
    // and the sequence silently never starts.
    seedSequence("seq-a", { trigger_source: "inquiry" })
    missingColumnOnInsert = "enrolment_metadata"

    const result = await enrollIfTriggered({
      contactId: "contact-1",
      source: "inquiry",
      metadata: { service: "camp" },
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(result.enrolled).toEqual(["seq-a"])
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].enrolment_metadata).toBeUndefined()
    // Everything else about the row still had to be written.
    expect(store.sequence_runs[0].contact_id).toBe("contact-1")
    expect(store.sequence_runs[0].current_position).toBe(0)
    // Exactly two attempts, and the retry dropped EXACTLY the one key.
    expect(runInsertPayloads).toHaveLength(2)
    expect(runInsertPayloads[0]).toHaveProperty("enrolment_metadata")
    expect(runInsertPayloads[1]).not.toHaveProperty("enrolment_metadata")
    expect(runInsertPayloads[1].next_run_at).toBeTruthy()
  })

  it("retries a PGRST204 about some OTHER column too, and then throws — it cannot swallow a real fault", async () => {
    // WHAT THE CODE ACTUALLY DOES, not what would be tidier.
    // `isMissingColumnError` reads the code only, so this is retried as
    // well; the second attempt drops only `enrolment_metadata`, still names
    // `next_run_at`, fails identically and throws. Asserting only "it
    // throws PGRST204 and wrote no row" would be true whether or not the
    // retry fired at all — the attempt count is the only thing that can see
    // it, which is why an earlier version of this test could not fail.
    seedSequence("seq-a", { trigger_source: "inquiry" })
    missingColumnOnInsert = "next_run_at"

    await expect(
      enrollIfTriggered({
        contactId: "contact-1",
        source: "inquiry",
        metadata: { service: "camp" },
        businessId: SINGLETON_BUSINESS_ID,
      }),
    ).rejects.toMatchObject({ code: "PGRST204" })
    expect(store.sequence_runs).toHaveLength(0)
    expect(runInsertPayloads).toHaveLength(2)
    // The load-bearing half: the retry dropped ONLY the metadata key, so it
    // could never have succeeded with a payload that was wrong elsewhere.
    expect(runInsertPayloads[1]).not.toHaveProperty("enrolment_metadata")
    expect(runInsertPayloads[1]).toHaveProperty("next_run_at")
  })

  it("retries for a MISSING COLUMN and for nothing else — one attempt on any other refusal", async () => {
    // Without counting attempts this is untestable: a retry that fires for
    // the wrong reason hits the same refusal again and throws the same
    // error, so the rows, the return value and the thrown code are all
    // identical either way. A tolerance widened to "any error" would be
    // invisible right up until it swallowed something.
    seedSequence("seq-a", { trigger_source: "inquiry" })
    insertRunError = { code: "23502", message: 'null value in column "contact_id" violates not-null constraint' }

    await expect(
      enrollIfTriggered({
        contactId: "contact-1",
        source: "inquiry",
        metadata: { service: "camp" },
        businessId: SINGLETON_BUSINESS_ID,
      }),
    ).rejects.toMatchObject({ code: "23502" })
    expect(runInsertPayloads).toHaveLength(1)
  })

  it("a manual enrolment carries no event, so it remembers nothing — and still writes the column", async () => {
    // `enrolContactManually` shares `insertSequenceRun`. There is no event to
    // read, so the honest answer is `{}` rather than a missing key.
    seedSequence("seq-manual", { key: "sms_repermission", trigger_source: null, status: "active" })

    const outcome = await enrolContactManually("contact-1", "sms_repermission", {
      businessId: SINGLETON_BUSINESS_ID,
    })

    expect(outcome).toEqual({ outcome: "enrolled" })
    expect(store.sequence_runs[0].enrolment_metadata).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// G14 — one sequence at a time (option B, owner's decision 2026-09-20).
//
// Until now a contact was enrolled into EVERY matching sequence and the
// younger run was deferred five minutes a tick so the oldest sent first
// (`siblingRunDefer`). That is a send-ORDER rule, not the "nobody is in two
// sequences at once" the quotation sells.
//
// The rule: when a trigger would enrol someone who already has an active run
// of a DIFFERENT sequence, either
//   - the new trigger is a direct response to something the person just did
//     (`quiz`, `inquiry`, `checkout_abandoned`, `event_signup`) — the older
//     run is exited `superseded` and the new one starts; or
//   - it is not — the new enrolment is refused, and the refusal is written to
//     the contact's timeline so it does not simply vanish.
// ---------------------------------------------------------------------------

/** An active run of some OTHER sequence, already in flight before this event. */
function seedActiveRun(id: string, contactId: string, sequenceId: string, overrides: Partial<Row> = {}) {
  store.sequence_runs.push({
    id,
    business_id: SINGLETON_BUSINESS_ID,
    sequence_id: sequenceId,
    contact_id: contactId,
    status: "active",
    current_position: 2,
    enrolled_at: daysAgo(3),
    ...overrides,
  })
}

function skipRows() {
  return store.contact_timeline_events.filter((e) => e.kind === "enrolment_skipped")
}

describe("enrollIfTriggered — one sequence at a time", () => {
  describe("a responsive trigger supersedes the run already in flight", () => {
    it("exits the older run with `superseded` and enrols the new one", async () => {
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-old", "contact-1", "seq-newsletter")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-quiz"])
      const old = store.sequence_runs.find((r) => r.id === "run-old")
      expect(old?.status).toBe("exited")
      expect(old?.exit_reason).toBe("superseded")
      expect(old?.completed_at).toBeTruthy()
      // The claim is released too, or the tick would still see it held.
      expect(old?.claimed_at).toBeNull()
      // And the new run really exists — without this the assertions above are
      // satisfied by "exited everything and enrolled nobody".
      expect(store.sequence_runs.filter((r) => r.status === "active")).toHaveLength(1)
    })

    it("supersedes for every source the rule names, and for no other", async () => {
      // Driven off the exported set rather than a list written here, so a
      // source added to the rule without a test goes to the `refused` half
      // and fails loudly.
      for (const source of ["quiz", "inquiry", "checkout_abandoned", "event_signup"] as const) {
        store.sequences = []
        store.sequence_runs = []
        store.contact_timeline_events = []
        expect(SUPERSEDING_SOURCES.has(source), `${source} is not in SUPERSEDING_SOURCES`).toBe(true)

        seedSequence("seq-other", { trigger_source: "newsletter" })
        seedSequence("seq-new", { trigger_source: source })
        seedActiveRun("run-old", "contact-1", "seq-other")

        const result = await enrollIfTriggered({
          contactId: "contact-1",
          source,
          businessId: SINGLETON_BUSINESS_ID,
        })

        expect(result.enrolled, `${source} did not enrol`).toEqual(["seq-new"])
        expect(store.sequence_runs.find((r) => r.id === "run-old")?.exit_reason, source).toBe("superseded")
      }
    })

    it("writes no skip note when it supersedes — the exited run is the record", async () => {
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-old", "contact-1", "seq-newsletter")

      await enrollIfTriggered({ contactId: "contact-1", source: "quiz", businessId: SINGLETON_BUSINESS_ID })

      expect(skipRows()).toHaveLength(0)
    })

    it("supersedes EVERY older run, not just the first", async () => {
      // Two active runs is reachable today through manual enrolment, which
      // this rule deliberately does not gate. Leaving one behind would put
      // the person back in two sequences the moment the rule was supposed to
      // guarantee they were in one.
      seedSequence("seq-a", { trigger_source: "newsletter" })
      seedSequence("seq-b", { trigger_source: "lead_magnet" })
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-a", "contact-1", "seq-a")
      seedActiveRun("run-b", "contact-1", "seq-b")

      await enrollIfTriggered({ contactId: "contact-1", source: "quiz", businessId: SINGLETON_BUSINESS_ID })

      expect(store.sequence_runs.find((r) => r.id === "run-a")?.status).toBe("exited")
      expect(store.sequence_runs.find((r) => r.id === "run-b")?.status).toBe("exited")
    })
  })

  describe("which sources supersede is a product decision, so it is pinned exactly", () => {
    it("is exactly these five, and nothing has been added to it quietly", () => {
      // Membership is the owner's call (2026-09-20), not an implementation
      // detail: each entry decides whether a real person's live follow-up
      // gets thrown away. Asserting the whole set — rather than only that
      // the members are present — is what stops another being added without
      // that decision being made again.
      //
      // `booking` joined on 2026-09-21 (G22), and this test is the reason the
      // decision got made rather than defaulted: adding `booking` to
      // `ContactEventSource` made `IS_SUPERSEDING_SOURCE` a compile error
      // until somebody answered, and then failed HERE until somebody agreed.
      // Booking time is the most deliberate act on the list — a slot in their
      // own diary — so it meets the rule the others do.
      //
      // It is UNREACHABLE today, and that is recorded rather than glossed: no
      // sequence has `trigger_source = 'booking'` (checked against production),
      // so a booking capture enrols nobody and there is nothing to supersede.
      // The live mechanism by which a booking ends a follow-up is
      // `exitRunsForContact(contactId, "booking", …)` in lib/bookings/ingest.ts.
      expect([...SUPERSEDING_SOURCES].sort()).toEqual(
        ["booking", "checkout_abandoned", "event_signup", "inquiry", "quiz"].sort(),
      )
    })

    it("lead_magnet is NOT in it, and a lead-magnet trigger is therefore refused", async () => {
      // Deliberately excluded, and checked against production rather than
      // assumed: `lead_magnet_delivery` opens with a wait and then "Did the
      // guide answer what you were looking for?" — the download itself is
      // delivered elsewhere. Missing it costs a nudge, which is not worth
      // throwing away a follow-up already in flight.
      expect(SUPERSEDING_SOURCES.has("lead_magnet")).toBe(false)

      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedSequence("seq-magnet", { trigger_source: "lead_magnet" })
      seedActiveRun("run-old", "contact-1", "seq-quiz")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "lead_magnet",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(store.sequence_runs.find((r) => r.id === "run-old")?.status).toBe("active")
    })
  })

  describe("a non-responsive trigger is refused", () => {
    it("does not enrol, and leaves the run already in flight alone", async () => {
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedActiveRun("run-old", "contact-1", "seq-quiz")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(store.sequence_runs).toHaveLength(1)
      const old = store.sequence_runs[0]
      expect(old.status).toBe("active")
      expect(old.exit_reason).toBeUndefined()
    })

    it("names the refusal on the contact's timeline, and says which sequence is in the way", async () => {
      seedSequence("seq-quiz", { trigger_source: "quiz", key: "quiz_rebuilder", name: "Quiz — Rebuilder" })
      seedSequence("seq-newsletter", { trigger_source: "newsletter", key: "newsletter_welcome" })
      seedActiveRun("run-old", "contact-1", "seq-quiz")

      await enrollIfTriggered({ contactId: "contact-1", source: "newsletter", businessId: SINGLETON_BUSINESS_ID })

      expect(skipRows()).toHaveLength(1)
      expect(skipRows()[0].metadata).toMatchObject({
        reason: "already_in_a_sequence",
        sequence_key: "newsletter_welcome",
        blocking_sequence_key: "quiz_rebuilder",
        blocking_sequence_name: "Quiz — Rebuilder",
      })
    })

    it("blames the same one every time when more than one run is in the way", async () => {
      // Reachable through manual enrolment, which this rule exempts. The
      // read has no ORDER BY, so without sorting the note names whichever
      // row Postgres happened to return first and two identical situations
      // would explain themselves differently.
      const blamed: Array<string | undefined> = []
      for (const order of [
        ["aaa-seq", "bbb-seq"],
        ["bbb-seq", "aaa-seq"],
      ]) {
        store.sequences = []
        store.sequence_runs = []
        store.contact_timeline_events = []
        order.forEach((id) => seedSequence(id, { trigger_source: "quiz", key: `key-${id}`, name: `Name ${id}` }))
        seedSequence("seq-news", { trigger_source: "newsletter", key: "newsletter_welcome" })
        order.forEach((id, i) => seedActiveRun(`run-${i}`, "contact-1", id))

        await enrollIfTriggered({ contactId: "contact-1", source: "newsletter", businessId: SINGLETON_BUSINESS_ID })
        blamed.push(skipRows()[0]?.metadata?.blocking_sequence_key)
      }

      expect(blamed[0]).toBe(blamed[1])
      expect(blamed[0]).toBe("key-aaa-seq")
    })
  })

  describe("the cost it adds to a lead capture", () => {
    it("reads no runs at all when no sequence matches the source", async () => {
      // `enrollIfTriggered` runs on EVERY lead capture, and most sources
      // (`shop`, `assessment`, `ai_chat`, `purchase`, …) have no sequence at
      // all. Two extra round-trips that cannot change the outcome is the
      // small cost; the real one is that their failure paths would reach an
      // enrolment that was never going to happen — `recordContactEvent`
      // swallows a throw, so a transient read error would silently lose it.
      seedSequence("seq-news", { trigger_source: "newsletter" })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "shop",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(readsByTable.sequences).toBe(1) // the candidate lookup, and nothing else
      expect(readsByTable.sequence_runs ?? 0).toBe(0)
    })

    it("does read them once when a sequence DOES match — the control", async () => {
      seedSequence("seq-news", { trigger_source: "newsletter" })

      await enrollIfTriggered({ contactId: "contact-1", source: "newsletter", businessId: SINGLETON_BUSINESS_ID })

      expect(readsByTable.sequence_runs).toBeGreaterThan(0)
    })
  })

  describe("what the rule does NOT change", () => {
    it("enrols normally when the contact has no active run at all", async () => {
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-newsletter"])
      expect(skipRows()).toHaveLength(0)
    })

    it("ignores a COMPLETED or EXITED run of another sequence", async () => {
      // Only an ACTIVE run means "they are in a sequence right now". A
      // finished one is the cooldown's business, not this rule's.
      seedSequence("seq-old", { trigger_source: "quiz" })
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedActiveRun("run-done", "contact-1", "seq-old", { status: "completed" })
      seedActiveRun("run-gone", "contact-1", "seq-old", { status: "exited", id: "run-gone" })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-newsletter"])
    })

    it("ignores an active run belonging to a DIFFERENT contact", async () => {
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedActiveRun("run-someone-else", "contact-2", "seq-quiz")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-newsletter"])
      expect(store.sequence_runs.find((r) => r.id === "run-someone-else")?.status).toBe("active")
    })

    it("ignores an active run of the same contact under a DIFFERENT business", async () => {
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedActiveRun("run-other-tenant", "contact-1", "seq-quiz", { business_id: OTHER_BUSINESS_ID })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-newsletter"])
      expect(store.sequence_runs.find((r) => r.id === "run-other-tenant")?.status).toBe("active")
    })

    it("an active run of the SAME sequence is the unique index's job, not this rule's", async () => {
      // The partial unique index already refuses this, and it must keep
      // returning "already enrolled" rather than superseding a run with
      // another run of the very same sequence.
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-old", "contact-1", "seq-quiz")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(store.sequence_runs).toHaveLength(1)
      expect(store.sequence_runs[0].status).toBe("active")
      expect(store.sequence_runs[0].exit_reason).toBeUndefined()
      expect(skipRows()).toHaveLength(0)
    })

    it("the cooldown still wins, and nothing is superseded for an enrolment that was never going to happen", async () => {
      // Order matters: exiting somebody's live follow-up to make room for a
      // run the cooldown then refuses would leave them in nothing at all.
      seedSequence("seq-newsletter", { trigger_source: "newsletter" })
      seedSequence("seq-quiz", { trigger_source: "quiz", reenrol_cooldown_days: 30 })
      seedActiveRun("run-old", "contact-1", "seq-newsletter")
      store.sequence_runs.push({
        id: "run-quiz-finished",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-quiz",
        contact_id: "contact-1",
        status: "completed",
        current_position: 5,
        completed_at: daysAgo(2),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(store.sequence_runs.find((r) => r.id === "run-old")?.status).toBe("active")
      expect(skipRows()[0]?.metadata).toMatchObject({ reason: "cooldown" })
    })
  })

  describe("one event enrols into at most one sequence", () => {
    it("refuses the second match rather than superseding the run it just created", async () => {
      // Latent today — no two active sequences can match one event on
      // production — but the alternative is an event enrolling somebody and
      // then immediately exiting its own enrolment, which is absurd and
      // would depend on the order the sequences happened to be read in.
      seedSequence("seq-a", { trigger_source: "quiz", key: "quiz_a" })
      seedSequence("seq-b", { trigger_source: "quiz", key: "quiz_b" })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toHaveLength(1)
      expect(store.sequence_runs.filter((r) => r.status === "active")).toHaveLength(1)
      expect(store.sequence_runs.every((r) => r.exit_reason === undefined)).toBe(true)
      expect(skipRows()).toHaveLength(1)
      expect(skipRows()[0].metadata).toMatchObject({ reason: "already_enrolled_this_event" })
    })

    it("picks the same one every time, rather than whichever the database returned first", async () => {
      // `key` order is arbitrary but STABLE. Nondeterminism here would mean
      // two identical submissions getting different follow-ups.
      const winners: string[] = []
      for (const order of [
        ["quiz_b", "quiz_a"],
        ["quiz_a", "quiz_b"],
      ]) {
        store.sequences = []
        store.sequence_runs = []
        store.contact_timeline_events = []
        order.forEach((key) => seedSequence(`seq-${key}`, { trigger_source: "quiz", key }))

        const result = await enrollIfTriggered({
          contactId: "contact-1",
          source: "quiz",
          businessId: SINGLETON_BUSINESS_ID,
        })
        winners.push(result.enrolled[0])
      }

      expect(winners[0]).toBe(winners[1])
      expect(winners[0]).toBe("seq-quiz_a")
    })
  })

  describe("a run WE cut short must not also lock the person out of it", () => {
    it("a superseded run does not count towards the cooldown", async () => {
      // The interaction G14 creates with G01, and it is only visible by
      // walking the two rules together:
      //
      //   day 0  they subscribe -> newsletter_welcome starts
      //   day 1  they take the quiz -> newsletter run exited `superseded`
      //   day 10 they subscribe AGAIN -> the cooldown sees an exited run
      //          from nine days ago and refuses for another three weeks
      //
      // They asked for the newsletter twice and never got it, because of a
      // run WE ended on their behalf. Exactly the reasoning already written
      // for `failed`: a run that did not end of its own accord must not also
      // lock somebody out of the sequence.
      seedSequence("seq-news", { trigger_source: "newsletter", reenrol_cooldown_days: 30 })
      store.sequence_runs.push({
        id: "run-superseded",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-news",
        contact_id: "contact-1",
        status: "exited",
        exit_reason: "superseded",
        current_position: 1,
        completed_at: daysAgo(9),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-news"])
      expect(skipRows()).toHaveLength(0)
    })

    it("forgives a run that ended because it had no anchor (G11)", async () => {
      // Review finding. The G11 interaction with G01, and it takes a real
      // person's camp away:
      //
      //   1 June  a coach hand-enrols a parent into camp_clinic_deadline.
      //           The run sends the acknowledgement, reaches the first
      //           "14 days before the camp" wait, has no event date behind
      //           it, and ends `not_anchored` the same day.
      //   8 June  the parent ACTUALLY registers interest in a camp.
      //           The 30-day cooldown sees a run that ended a week ago and
      //           refuses — so they get no countdown for a camp they signed
      //           up for, because of a run we ended ourselves.
      //
      // Same principle the `failed` exclusion already carries: a run that
      // ended because it could not RUN must not also lock the person out of
      // the repaired one.
      seedSequence("seq-camp", { trigger_source: "event_signup", reenrol_cooldown_days: 30 })
      store.sequence_runs.push({
        id: "run-not-anchored",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-camp",
        contact_id: "contact-1",
        status: "exited",
        exit_reason: "not_anchored",
        current_position: 1,
        completed_at: daysAgo(7),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "event_signup",
        businessId: SINGLETON_BUSINESS_ID,
        anchorAt: "2026-11-01T09:00:00.000Z",
      })

      expect(result.enrolled).toEqual(["seq-camp"])
      expect(skipRows()).toHaveLength(0)
    })

    it("and the control: an ordinary completed run of the same sequence IS still held", async () => {
      // Without this, the test above would pass just as well if the cooldown
      // had stopped working altogether. `event_signup` is a superseding
      // source, so it also proves the forgiveness above is not simply the
      // superseding-trigger path in disguise.
      seedSequence("seq-camp", { trigger_source: "event_signup", reenrol_cooldown_days: 30 })
      store.sequence_runs.push({
        id: "run-finished",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-camp",
        contact_id: "contact-1",
        status: "completed",
        exit_reason: null,
        current_position: 7,
        completed_at: daysAgo(7),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "event_signup",
        businessId: SINGLETON_BUSINESS_ID,
        anchorAt: "2026-11-01T09:00:00.000Z",
      })

      expect(result.enrolled).toEqual([])
      expect(skipRows()).toHaveLength(1)
    })

    it("but a SUPERSEDING trigger is still held by the cooldown — or the two rules cancel", async () => {
      // Review finding. Forgiving a `superseded` run for every trigger lets
      // a chaser re-arm itself: somebody in `abandoned_checkout` takes the
      // quiz (run superseded), abandons another checkout a week later, and
      // is re-enrolled into `abandoned_checkout` from step 1 INSIDE its
      // 30-day window — the incident the cooldown was written for, back
      // through a door G14 opened. The forgiveness is for a person asking
      // again for something ordinary, not for a chaser.
      seedSequence("seq-abandoned", { trigger_source: "checkout_abandoned", reenrol_cooldown_days: 30 })
      store.sequence_runs.push({
        id: "run-superseded",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-abandoned",
        contact_id: "contact-1",
        status: "exited",
        exit_reason: "superseded",
        current_position: 1,
        completed_at: daysAgo(7),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "checkout_abandoned",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(skipRows()[0]?.metadata).toMatchObject({ reason: "cooldown" })
    })

    it("but an ordinary exit inside the window still does — the control", async () => {
      // Without this, the fix above could be "the cooldown no longer looks
      // at exited runs at all", which would undo G01 for unsubscribes,
      // bookings and purchases.
      seedSequence("seq-news", { trigger_source: "newsletter", reenrol_cooldown_days: 30 })
      store.sequence_runs.push({
        id: "run-unsubscribed",
        business_id: SINGLETON_BUSINESS_ID,
        sequence_id: "seq-news",
        contact_id: "contact-1",
        status: "exited",
        exit_reason: "unsubscribed",
        current_position: 1,
        completed_at: daysAgo(9),
      })

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual([])
      expect(skipRows()[0]?.metadata).toMatchObject({ reason: "cooldown" })
    })
  })

  describe("a manual-only sequence sits outside the rule in BOTH directions", () => {
    it("is never superseded — a compliance ask must survive a quiz submission", async () => {
      // Review finding, and the worst of the two Criticals. `sms_repermission`
      // is "one ask, then stop" (migration 00223) and `enrolContactManually`'s
      // `onePerContact` counts runs of ANY status. So superseding it would
      // exit the ask, never send it, and make it impossible to create again —
      // destroyed permanently, silently, with the exited run captioned
      // "they did something that started a better-matching follow-up", which
      // is simply false for a permission request.
      seedSequence("seq-manual", { key: "sms_repermission", trigger_source: null })
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-ask", "contact-1", "seq-manual")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-quiz"])
      const ask = store.sequence_runs.find((r) => r.id === "run-ask")
      expect(ask?.status).toBe("active")
      expect(ask?.exit_reason).toBeUndefined()
    })

    it("and never blocks either — the symmetry, or the exemption fails the other way", async () => {
      // Merely making it non-supersedable would turn it into a permanent
      // blocker: every non-superseding trigger would be refused for as long
      // as the ask sat unanswered.
      seedSequence("seq-manual", { key: "sms_repermission", trigger_source: null })
      seedSequence("seq-news", { trigger_source: "newsletter" })
      seedActiveRun("run-ask", "contact-1", "seq-manual")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "newsletter",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-news"])
      expect(skipRows()).toHaveLength(0)
      expect(store.sequence_runs.find((r) => r.id === "run-ask")?.status).toBe("active")
    })

    it("a run whose sequence cannot be read is left alone, not superseded", async () => {
      // Fails CLOSED. If `describeSequences` cannot identify the sequence
      // behind an active run — the row is gone, the read failed — the rule
      // must not exit it. Guessing "supersedable" is how a compliance ask
      // gets destroyed by a query that happened to error.
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-orphan", "contact-1", "seq-that-does-not-exist")

      const result = await enrollIfTriggered({
        contactId: "contact-1",
        source: "quiz",
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(result.enrolled).toEqual(["seq-quiz"])
      const orphan = store.sequence_runs.find((r) => r.id === "run-orphan")
      expect(orphan?.status).toBe("active")
      expect(orphan?.exit_reason).toBeUndefined()
    })

    it("an ordinary triggered sequence IS still superseded — the control", async () => {
      // Without this, "never supersedes anything" would pass both tests above.
      seedSequence("seq-news", { trigger_source: "newsletter" })
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedActiveRun("run-news", "contact-1", "seq-news")

      await enrollIfTriggered({ contactId: "contact-1", source: "quiz", businessId: SINGLETON_BUSINESS_ID })

      expect(store.sequence_runs.find((r) => r.id === "run-news")?.exit_reason).toBe("superseded")
    })
  })

  describe("manual enrolment is deliberately exempt", () => {
    it("a coach can still enrol somebody who is already in a sequence", async () => {
      // A human's explicit instruction, not a trigger. Refusing it silently
      // would be worse than the two runs, which `siblingRunDefer` still
      // serialises so only one of them sends on any given tick.
      seedSequence("seq-quiz", { trigger_source: "quiz" })
      seedSequence("seq-manual", { key: "sms_repermission", trigger_source: null, status: "active" })
      seedActiveRun("run-old", "contact-1", "seq-quiz")

      const outcome = await enrolContactManually("contact-1", "sms_repermission", {
        businessId: SINGLETON_BUSINESS_ID,
      })

      expect(outcome).toEqual({ outcome: "enrolled" })
      expect(store.sequence_runs.find((r) => r.id === "run-old")?.status).toBe("active")
      expect(store.sequence_runs.filter((r) => r.status === "active")).toHaveLength(2)
    })
  })
})
