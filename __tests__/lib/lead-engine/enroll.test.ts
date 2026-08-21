// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

type Row = Record<string, any>

const store: { sequences: Row[]; sequence_runs: Row[] } = { sequences: [], sequence_runs: [] }

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

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
    from: (table: "sequences" | "sequence_runs") => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      let mode: "select" | "insert" = "select"
      let payload: Row | null = null

      const passesFilters = (row: Row) => filters.every(([col, val]) => row[col] === val)

      const doSelect = () => ({ data: rows.filter(passesFilters), error: null })

      const doInsert = () => {
        const p = payload as Row
        if (table === "sequence_runs") {
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

      const execute = () => (mode === "insert" ? doInsert() : doSelect())

      const api: any = {
        select: () => api,
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        insert: (p: Row) => {
          mode = "insert"
          payload = p
          return execute()
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

import { enrollIfTriggered, enrolContactManually } from "@/lib/lead-engine/enroll"
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
  seqCounter = 0
})

describe("enrollIfTriggered", () => {
  it("enrols into every active sequence whose trigger matches the source", async () => {
    seedSequence("seq-a", { trigger_source: "funnel_form" })
    seedSequence("seq-b", { trigger_source: "funnel_form" })
    seedSequence("seq-c", { trigger_source: "newsletter" })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form" })

    expect(result.enrolled.sort()).toEqual(["seq-a", "seq-b"])
    expect(store.sequence_runs).toHaveLength(2)
    for (const run of store.sequence_runs) {
      expect(run.contact_id).toBe("contact-1")
      expect(run.business_id).toBe(SINGLETON_BUSINESS_ID)
      expect(run.current_position).toBe(0)
      expect(run.next_run_at).toBeTruthy()
    }
  })

  it("ignores draft, paused and archived sequences", async () => {
    seedSequence("seq-draft", { status: "draft" })
    seedSequence("seq-paused", { status: "paused" })
    seedSequence("seq-archived", { status: "archived" })
    seedSequence("seq-active", { status: "active" })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form" })

    expect(result.enrolled).toEqual(["seq-active"])
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].sequence_id).toBe("seq-active")
  })

  it("ignores sequences whose trigger_source is null", async () => {
    seedSequence("seq-null-trigger", { trigger_source: null, status: "active" })
    seedSequence("seq-matching", { trigger_source: "funnel_form", status: "active" })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form" })

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

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form" })

    expect(result.enrolled).toEqual([])
    // No new row was inserted — the one already there is untouched.
    expect(store.sequence_runs).toHaveLength(1)
    expect(store.sequence_runs[0].id).toBe("existing-run")
  })

  it("continues to the next sequence after swallowing a 23505 on an earlier one", async () => {
    seedSequence("seq-dup", { trigger_source: "funnel_form" })
    seedSequence("seq-new", { trigger_source: "funnel_form" })
    store.sequence_runs.push({
      id: "existing-run",
      business_id: SINGLETON_BUSINESS_ID,
      sequence_id: "seq-dup",
      contact_id: "contact-1",
      status: "active",
      current_position: 0,
    })

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "funnel_form" })

    expect(result.enrolled).toEqual(["seq-new"])
    expect(store.sequence_runs).toHaveLength(2)
  })

  it("applies trigger_filter against the event metadata", async () => {
    seedSequence("seq-filtered", { trigger_filter: { funnel_id: "abc" } })
    seedSequence("seq-open", { trigger_filter: {} })

    const mismatch = await enrollIfTriggered({
      contactId: "contact-1",
      source: "funnel_form",
      metadata: { funnel_id: "xyz" },
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

    const result = await enrollIfTriggered({ contactId: "contact-1", source: "purchase" })

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

    const result = await enrolContactManually("contact-1", "sms_repermission")

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

    const result = await enrolContactManually("contact-1", "sms_repermission")

    expect(result).toEqual({ outcome: "sequence_not_active", status: "draft" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  it("refuses to enrol into a paused or archived sequence the same way", async () => {
    seedSequence("seq-paused", { key: "seq-paused-key", trigger_source: null, status: "paused" })

    const result = await enrolContactManually("contact-1", "seq-paused-key")

    expect(result).toEqual({ outcome: "sequence_not_active", status: "paused" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  it("reports sequence_not_found for an unknown key rather than silently no-oping", async () => {
    const result = await enrolContactManually("contact-1", "does-not-exist")

    expect(result).toEqual({ outcome: "sequence_not_found" })
    expect(store.sequence_runs).toHaveLength(0)
  })

  // The duplicate-run guard: a second manual enrolment of the same contact
  // into the same sequence must no-op, not create a second sequence_runs
  // row and not throw. This is the exact mechanism
  // scripts/enrol-repermission.ts relies on to be safely re-runnable.
  it("no-ops on a second enrolment of the same contact into the same sequence", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    const first = await enrolContactManually("contact-1", "sms_repermission")
    const second = await enrolContactManually("contact-1", "sms_repermission")

    expect(first).toEqual({ outcome: "enrolled" })
    expect(second).toEqual({ outcome: "already_enrolled" })
    expect(store.sequence_runs).toHaveLength(1)
  })

  it("still enrols a different contact into the same sequence after a duplicate no-op", async () => {
    seedSequence("seq-repermission", { key: "sms_repermission", trigger_source: null, status: "active" })

    await enrolContactManually("contact-1", "sms_repermission")
    const result = await enrolContactManually("contact-2", "sms_repermission")

    expect(result).toEqual({ outcome: "enrolled" })
    expect(store.sequence_runs).toHaveLength(2)
  })
})
