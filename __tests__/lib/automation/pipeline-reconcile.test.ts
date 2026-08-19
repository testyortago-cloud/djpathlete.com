// @vitest-environment node
//
// `runPipelineReconcile` is the IO shell for the Lead Engine pipeline
// reconciler (Task 6). It is NOT mocked here — its real logic, including the
// pure decision core it routes through (`decideMove`,
// lib/lead-engine/pipeline-move.ts, via `applyPipelineEvent`,
// lib/db/pipeline.ts), runs for real against an in-memory Supabase mock.
// Only `@/lib/supabase` is mocked. This is the same "mock the DAL, run the
// real logic" shape as __tests__/db/pipeline.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

type Store = {
  pipelines: Row[]
  pipeline_stages: Row[]
  opportunities: Row[]
  opportunity_stage_events: Row[]
  contacts: Row[]
  audit_logs: Row[]
  bookings: Row[]
  payments: Row[]
}

const store: Store = {
  pipelines: [],
  pipeline_stages: [],
  opportunities: [],
  opportunity_stage_events: [],
  contacts: [],
  audit_logs: [],
  bookings: [],
  payments: [],
}

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

// Final review, Important 1: when set, the next INSERT into `opportunities`
// for this contact_id returns a Postgres-shaped error instead of writing the
// row — the same "force an error on one specific row" idea as
// __tests__/db/sequences.test.ts's `forceErrorOnTable`, narrowed to one
// contact rather than a whole table, so it can prove one poisoned row
// doesn't take down every other row in the same reconcile pass.
let forceErrorOnContactId: string | null = null

// NOTE ON THE MOCK: copied (structure verbatim) from __tests__/db/pipeline.test.ts,
// which itself copied __tests__/db/sequences.test.ts's harness. The trap this
// project has hit twice is a `.eq()` that returns the query object without
// recording the filter, so every query resolves to "everything in the
// table" and every assertion passes without ever exercising the real
// filtering logic. This mock tracks every applied `.eq()`/`.gte()`/`.lt()`/
// `.in()` filter and narrows the row set for real. `.in()` is new here — the
// booking scan filters on a status LIST (`scheduled`,`completed`), which
// nothing in this repo's existing mock harnesses needed before.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: keyof Store) => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      const gteFilters: Array<[string, any]> = []
      const ltFilters: Array<[string, any]> = []
      const inFilters: Array<[string, any[]]> = []
      let orderCol: string | null = null
      let orderAscending = true
      let limitN: number | null = null
      let mode: "select" | "insert" | "update" = "select"
      let payload: Row | null = null

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) &&
        gteFilters.every(([col, val]) => row[col] >= val) &&
        ltFilters.every(([col, val]) => row[col] < val) &&
        inFilters.every(([col, vals]) => vals.includes(row[col]))

      const matched = (): Row[] => {
        let result = rows.filter(passesFilters)
        if (orderCol) {
          const col = orderCol
          result = [...result].sort((a, b) => {
            if (a[col] === b[col]) return a._seq - b._seq
            return a[col] > b[col] ? 1 : -1
          })
          if (!orderAscending) result.reverse()
        }
        if (limitN != null) result = result.slice(0, limitN)
        return result
      }

      const doInsert = (): { data: any; error: any } => {
        const p = payload as Row
        if (table === "opportunities" && forceErrorOnContactId && p.contact_id === forceErrorOnContactId) {
          return { data: null, error: new Error("simulated insert failure") }
        }
        const row: Row = {
          ...p,
          id: p.id ?? nextId(String(table)),
          created_at: p.created_at ?? new Date().toISOString(),
          updated_at: p.updated_at ?? new Date().toISOString(),
          // opportunity_stage_events.occurred_at is `NOT NULL DEFAULT now()`
          // (migration 00219) — insertStageEvent (lib/db/pipeline.ts) never
          // sets it explicitly, relying on Postgres. Fix round 1, Finding 3
          // added a `.gte("occurred_at", …)` read against this column, so
          // the mock must fake the same server-side default `created_at`/
          // `updated_at` already get below, or every inserted row silently
          // fails that filter (`undefined >= isoString` is false) and the
          // idempotency ledger reads back empty forever.
          occurred_at: p.occurred_at ?? new Date().toISOString(),
          _seq: rows.length,
        }
        rows.push(row)
        return { data: [row], error: null }
      }

      const doUpdate = (): { data: any; error: any } => {
        const targets = rows.filter(passesFilters)
        for (const row of targets) Object.assign(row, payload)
        return { data: [...targets], error: null }
      }

      const execute = (): { data: any; error: any } => {
        if (mode === "insert") return doInsert()
        if (mode === "update") return doUpdate()
        return { data: matched(), error: null }
      }

      const api: any = {
        select: () => api,
        insert: (p: Row) => {
          mode = "insert"
          payload = p
          return api
        },
        update: (p: Row) => {
          mode = "update"
          payload = p
          return api
        },
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        gte: (col: string, val: any) => {
          gteFilters.push([col, val])
          return api
        },
        lt: (col: string, val: any) => {
          ltFilters.push([col, val])
          return api
        },
        in: (col: string, vals: any[]) => {
          inFilters.push([col, vals])
          return api
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAscending = opts?.ascending ?? true
          return api
        },
        limit: (n: number) => {
          limitN = n
          return api
        },
        maybeSingle: async () => {
          const { data, error } = execute()
          if (error) return { data: null, error }
          const arr: Row[] = Array.isArray(data) ? data : data ? [data] : []
          return { data: arr[0] ?? null, error: null }
        },
        single: async () => {
          const { data, error } = execute()
          if (error) return { data: null, error }
          const arr: Row[] = Array.isArray(data) ? data : data ? [data] : []
          if (!arr[0]) return { data: null, error: new Error("no rows returned") }
          return { data: arr[0], error: null }
        },
        // Makes a bare `await supabase.from(...).select(...).eq(...)` (no
        // terminal .single()/.maybeSingle()) resolve like the real client.
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

import { runPipelineReconcile, PIPELINE_RECONCILE_WINDOW_DAYS } from "@/lib/automation/pipeline-reconcile"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { DEFAULT_PIPELINE_KEY } from "@/lib/db/pipeline"

const DAY_MS = 86_400_000

beforeEach(() => {
  store.pipelines = []
  store.pipeline_stages = []
  store.opportunities = []
  store.opportunity_stage_events = []
  store.contacts = []
  store.audit_logs = []
  store.bookings = []
  store.payments = []
  seqCounter = 0
  forceErrorOnContactId = null
})

// ---------------------------------------------------------------------------
// Fixtures: one seeded board matching migration 00219's real seed — same
// shape as __tests__/db/pipeline.test.ts's fixtures.
// ---------------------------------------------------------------------------

function seedBoard() {
  store.pipelines.push({
    id: "pipe-1",
    business_id: SINGLETON_BUSINESS_ID,
    key: DEFAULT_PIPELINE_KEY,
    name: "Coaching",
    status: "active",
  })
  store.pipeline_stages.push(
    {
      id: "stage-consult-booked",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: "pipe-1",
      key: "consult_booked",
      name: "Consult Booked",
      position: 1,
      kind: "open",
      amber_after_days: 3,
      red_after_days: 7,
    },
    {
      id: "stage-consulted",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: "pipe-1",
      key: "consulted",
      name: "Consulted",
      position: 2,
      kind: "open",
      amber_after_days: 5,
      red_after_days: 14,
    },
    {
      id: "stage-won",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: "pipe-1",
      key: "won",
      name: "Won",
      position: 3,
      kind: "won",
      amber_after_days: null,
      red_after_days: null,
    },
    {
      id: "stage-lost",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: "pipe-1",
      key: "lost",
      name: "Lost",
      position: 4,
      kind: "lost",
      amber_after_days: null,
      red_after_days: null,
    },
  )
}

function seedContact(id: string, overrides: Row = {}) {
  store.contacts.push({
    id,
    business_id: SINGLETON_BUSINESS_ID,
    email: null,
    phone_e164: null,
    user_id: null,
    name: null,
    first_touch_session_id: null,
    ...overrides,
  })
}

function seedOpportunity(id: string, contactId: string, overrides: Row = {}): Row {
  const opp = {
    id,
    business_id: SINGLETON_BUSINESS_ID,
    pipeline_id: "pipe-1",
    contact_id: contactId,
    stage_id: "stage-consult-booked",
    entered_stage_at: new Date().toISOString(),
    value_cents: null,
    currency: "usd",
    source_session_id: null,
    outcome: null,
    outcome_reason: null,
    closed_at: null,
    closed_trigger: null,
    closed_by_user_id: null,
    created_at: new Date().toISOString(),
    _seq: store.opportunities.length,
    ...overrides,
  }
  store.opportunities.push(opp)
  return opp
}

function seedBooking(id: string, overrides: Row = {}) {
  store.bookings.push({
    id,
    contact_name: "Lead",
    contact_email: "lead@example.com",
    contact_phone: null,
    booking_date: new Date().toISOString(),
    duration_minutes: 30,
    status: "scheduled",
    source: "ghl",
    notes: null,
    ghl_contact_id: null,
    ghl_appointment_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  })
}

function seedPayment(id: string, overrides: Row = {}) {
  store.payments.push({
    id,
    user_id: null,
    stripe_payment_id: null,
    stripe_customer_id: null,
    amount_cents: 9900,
    currency: "usd",
    status: "succeeded",
    description: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  })
}

function stageEventsFor(opportunityId: string): Row[] {
  return store.opportunity_stage_events.filter((e) => e.opportunity_id === opportunityId)
}

describe("runPipelineReconcile", () => {
  it("creates a card for a booking whose contact has no opportunity", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com" })
    seedBooking("bk-1", { contact_email: "lead@example.com", status: "scheduled" })

    const summary = await runPipelineReconcile()

    expect(summary.createdFromBookings).toBe(1)
    expect(summary.wonFromPayments).toBe(0)
    expect(store.opportunities).toHaveLength(1)
    expect(store.opportunities[0].contact_id).toBe("c-1")
    expect(store.opportunities[0].stage_id).toBe("stage-consult-booked")

    const events = stageEventsFor(store.opportunities[0].id)
    expect(events).toHaveLength(1)
    expect(events[0].trigger).toBe("reconciler")
    expect(events[0].metadata).toEqual({ booking_id: "bk-1" })
  })

  // The reconciler routes every scanned booking through decideMove
  // unconditionally (no local "is this contact already handled" pre-filter —
  // see the module header). That means the SQL status filter
  // (`scheduled`/`completed` only) is the ONLY thing stopping a cancelled/
  // no_show booking from reaching decideMove's cancelled/no_show branch and
  // closing an open card as Lost through this backstop path, which is out of
  // this reconciler's scope (spec §6 item 1). Proves the `.in()` filter is
  // load-bearing, not decorative.
  it("ignores cancelled and no_show bookings", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })
    seedBooking("bk-cancelled", { contact_email: "lead@example.com", status: "cancelled" })
    seedBooking("bk-no-show", { contact_email: "lead@example.com", status: "no_show" })

    const summary = await runPipelineReconcile()

    expect(summary.scanned).toBe(0) // excluded by the SQL filter, never even fetched
    expect(store.opportunities.find((o) => o.id === "opp-1")!.outcome).toBeNull()
    expect(stageEventsFor("opp-1")).toHaveLength(0)
  })

  it("wins an open card whose contact has a succeeded payment", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com", user_id: "user-1" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })
    seedPayment("pay-1", { user_id: "user-1", amount_cents: 25000, status: "succeeded" })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(1)
    expect(summary.createdFromBookings).toBe(0)

    const opp = store.opportunities.find((o) => o.id === "opp-1")!
    expect(opp.outcome).toBe("won")
    expect(opp.value_cents).toBe(25000)
    expect(opp.closed_trigger).toBe("payment") // real trigger, not relabelled (C1)

    const events = stageEventsFor("opp-1")
    expect(events).toHaveLength(1)
    expect(events[0].trigger).toBe("reconciler")
    expect(events[0].metadata).toEqual({ payment_id: "pay-1" })
  })

  // Final review, Critical 1: REVERTS fix round 1's "replay every succeeded
  // payment unconditionally" ruling, which contradicted spec §6 case 2
  // ("payments... whose contact has an OPEN opportunity → win it") and would
  // fabricate a Won card for any contact who ever paid for anything —
  // including an existing coaching client's subscription/pack renewal,
  // neither of which carries a `metadata.type` NON_COACHING_PAYMENT_TYPES
  // would catch. A payment for a contact with NO opportunity at all must
  // create nothing; that gap is a stated, accepted limitation (see the
  // module header) to be entered by hand, not silently fabricated.
  it("creates nothing for a payment when the contact has no opportunity at all", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com", user_id: "user-1" })
    seedPayment("pay-1", { user_id: "user-1", amount_cents: 50000, status: "succeeded" })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(0)
    expect(summary.createdFromBookings).toBe(0)
    expect(store.opportunities).toHaveLength(0)
    expect(store.opportunity_stage_events).toHaveLength(0)
  })

  // The precondition must also exclude a contact whose only opportunity is
  // already CLOSED (won or lost) — not just "no opportunity at all" — since
  // spec §6 case 2 requires an OPEN card specifically.
  it("creates nothing for a payment when the contact's only opportunity is already closed", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com", user_id: "user-1" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-won", outcome: "won", closed_trigger: "payment" })
    seedPayment("pay-1", { user_id: "user-1", amount_cents: 50000, status: "succeeded" })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(0)
    expect(store.opportunities).toHaveLength(1)
    expect(stageEventsFor("opp-1")).toHaveLength(0)
  })

  // Confirms NON_COACHING_PAYMENT_TYPES is still real defense-in-depth after
  // Critical 1 restored the open-opportunity precondition — NOT redundant
  // with it. Both contacts here DO have an open card (so the precondition
  // alone would let the payment through); the type exclusion is the only
  // thing stopping a no-show fee or an event ticket from wrongly winning a
  // deal that is genuinely still open.
  it("ignores event_signup and session_fee payments even when the contact has an open opportunity", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead1@example.com", user_id: "user-1" })
    seedContact("c-2", { email: "lead2@example.com", user_id: "user-2" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })
    seedOpportunity("opp-2", "c-2", { stage_id: "stage-consulted" })
    seedPayment("pay-event", { user_id: "user-1", amount_cents: 4500, metadata: { type: "event_signup" } })
    seedPayment("pay-fee", {
      user_id: "user-2",
      amount_cents: 3000,
      metadata: { type: "session_fee", kind: "no_show" },
    })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(0)
    expect(summary.scanned).toBe(2) // fetched (status='succeeded' passed the SQL filter) — excluded in-loop, not by SQL
    expect(store.opportunities.find((o) => o.id === "opp-1")!.outcome).toBeNull()
    expect(store.opportunities.find((o) => o.id === "opp-2")!.outcome).toBeNull()
  })

  // The precondition alone (no type exclusion involved): both contacts here
  // have NO opportunity at all, so Critical 1's restored check is what stops
  // these — not NON_COACHING_PAYMENT_TYPES, which doesn't even list these
  // payment types.
  it("ignores payments for contacts with no opportunity, regardless of payment type", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead1@example.com", user_id: "user-1" })
    seedContact("c-2", { email: "lead2@example.com", user_id: "user-2" })
    // No `type` key — the exact shape a subscription renewal writes
    // (app/api/stripe/webhook/route.ts's handleInvoicePaymentSucceeded).
    seedPayment("pay-renewal", { user_id: "user-1", amount_cents: 9900, metadata: {} })
    // "session_pack" — the exact shape a pack auto-renewal writes
    // (lib/services/pack-renewal.ts), and NOT in NON_COACHING_PAYMENT_TYPES.
    seedPayment("pay-pack", { user_id: "user-2", amount_cents: 15000, metadata: { type: "session_pack" } })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(0)
    expect(store.opportunities).toHaveLength(0)
  })

  it("ignores payments that are pending, failed or refunded", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com", user_id: "user-1" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })
    seedPayment("pay-pending", { user_id: "user-1", status: "pending" })
    seedPayment("pay-failed", { user_id: "user-1", status: "failed" })
    seedPayment("pay-refunded", { user_id: "user-1", status: "refunded" })

    const summary = await runPipelineReconcile()

    expect(summary.wonFromPayments).toBe(0)
    expect(summary.scanned).toBe(0) // the SQL filter excluded them, not a post-filter
    expect(store.opportunities.find((o) => o.id === "opp-1")!.outcome).toBeNull()
  })

  it("ignores bookings older than the scan window", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com" })
    const stale = new Date(Date.now() - (PIPELINE_RECONCILE_WINDOW_DAYS + 1) * DAY_MS).toISOString()
    seedBooking("bk-old", { contact_email: "lead@example.com", status: "scheduled", created_at: stale })

    const summary = await runPipelineReconcile()

    expect(summary.createdFromBookings).toBe(0)
    expect(summary.scanned).toBe(0)
    expect(store.opportunities).toHaveLength(0)
  })

  it("does not resurrect a card a human closed", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead@example.com" })
    const recentClose = new Date(Date.now() - 5 * DAY_MS).toISOString()
    seedOpportunity("opp-1", "c-1", {
      stage_id: "stage-lost",
      outcome: "lost",
      closed_trigger: "manual",
      closed_at: recentClose,
      closed_by_user_id: "admin-1",
    })
    seedBooking("bk-1", { contact_email: "lead@example.com", status: "scheduled" })

    const summary = await runPipelineReconcile()

    // No new card — decideMove's own suppression guard refused it. This is
    // reused, not re-implemented: the reconciler carries no "is this
    // manually closed" check of its own.
    expect(summary.createdFromBookings).toBe(0)
    expect(store.opportunities).toHaveLength(1)
    expect(store.opportunities[0].stage_id).toBe("stage-lost")
    expect(store.opportunities[0].outcome).toBe("lost")

    const events = stageEventsFor("opp-1")
    expect(events).toHaveLength(1)
    expect(events[0].refused_reason).toBe("suppressed_after_manual_lost")
    expect(events[0].trigger).toBe("reconciler")
    expect(events[0].metadata).toEqual({ booking_id: "bk-1" })
  })

  it("reports counts so a non-zero result is visible as a bug signal", async () => {
    seedBoard()
    seedContact("c-1", { email: "lead1@example.com" })
    seedContact("c-2", { email: "lead2@example.com", user_id: "user-2" })
    seedOpportunity("opp-2", "c-2", { stage_id: "stage-consulted" })
    seedBooking("bk-1", { contact_email: "lead1@example.com", status: "scheduled" })
    seedPayment("pay-1", { user_id: "user-2", status: "succeeded" })

    const summary = await runPipelineReconcile()

    expect(summary).toEqual({ createdFromBookings: 1, wonFromPayments: 1, scanned: 2, failed: 0 })
  })

  // Final review, Important 1: before this fix, neither loop had a per-row
  // try/catch, so ONE poisoned row (a unique violation, a missing contact,
  // etc. — here simulated as an insert failure on the opportunities table)
  // aborted the WHOLE pass, silently repairing nothing for every other row
  // in the same scan. A reconciler that gives up on the first bad row is
  // worse than none: it reports failure while doing nothing, hourly, for the
  // full 30-day window.
  it("does not let one poisoned row abort the rest of the pass", async () => {
    seedBoard()
    seedContact("c-good", { email: "good@example.com" })
    seedContact("c-bad", { email: "bad@example.com" })
    seedBooking("bk-bad", { contact_email: "bad@example.com", status: "scheduled" })
    seedBooking("bk-good", { contact_email: "good@example.com", status: "scheduled" })

    forceErrorOnContactId = "c-bad"
    let summary: Awaited<ReturnType<typeof runPipelineReconcile>>
    try {
      summary = await runPipelineReconcile()
    } finally {
      forceErrorOnContactId = null
    }

    expect(summary!.failed).toBe(1)
    expect(summary!.createdFromBookings).toBe(1) // the good row still landed
    expect(store.opportunities).toHaveLength(1)
    expect(store.opportunities[0].contact_id).toBe("c-good")
  })

  // "The whole point" (task-6-brief.md). Two source rows, deliberately picked
  // so a plain re-run of the CREATE case alone would not prove anything: a
  // repeated `applyPipelineEvent` call for an already-created card converges
  // to `noop` on its own (decideMove sees the card already exists, at the
  // same stage) and writes nothing either way. The REFUSE case is the one
  // that depends on the metadata check: without it, `decideMove` refuses the
  // SAME suppressed rebooking again on every single pass (nothing about
  // `current` changes when a refusal happens — no stage move, no fields
  // updated) and `applyPipelineEvent` writes a brand-new refused stage event
  // every time. See task-6-report.md for the mutation that proves this.
  it("creates nothing new on a second pass — idempotent", async () => {
    seedBoard()

    // Contact A: fresh booking, no prior opportunity — creates a card.
    seedContact("c-a", { email: "a@example.com" })
    seedBooking("bk-a", { contact_email: "a@example.com", status: "scheduled" })

    // Contact B: human-closed 'lost' 10 days ago, rebooking inside the
    // 30-day suppression window — refused, and current never changes.
    seedContact("c-b", { email: "b@example.com" })
    const recentClose = new Date(Date.now() - 10 * DAY_MS).toISOString()
    seedOpportunity("opp-b", "c-b", {
      stage_id: "stage-lost",
      outcome: "lost",
      closed_trigger: "manual",
      closed_at: recentClose,
      closed_by_user_id: "admin-1",
    })
    seedBooking("bk-b", { contact_email: "b@example.com", status: "scheduled" })

    const first = await runPipelineReconcile()
    expect(first.createdFromBookings).toBe(1)
    expect(store.opportunities).toHaveLength(2) // A's new card + B's untouched closed one
    expect(store.opportunity_stage_events).toHaveLength(2) // A's create + B's refuse

    const second = await runPipelineReconcile()
    expect(second.createdFromBookings).toBe(0)
    expect(second.wonFromPayments).toBe(0)
    expect(store.opportunities).toHaveLength(2)
    // No duplicate card for A, and — the part that actually depends on the
    // metadata check — no second refusal row for B.
    expect(store.opportunity_stage_events).toHaveLength(2)
  })
})
