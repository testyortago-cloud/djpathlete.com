// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

type Store = {
  pipelines: Row[]
  pipeline_stages: Row[]
  opportunities: Row[]
  opportunity_stage_events: Row[]
  contacts: Row[]
  audit_logs: Row[]
}

const store: Store = {
  pipelines: [],
  pipeline_stages: [],
  opportunities: [],
  opportunity_stage_events: [],
  contacts: [],
  audit_logs: [],
}

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

/**
 * Whether the in-memory `opportunities` table knows about migration 00225's
 * `source_event_id` column.
 *
 * Flipped to `false` by one test to reproduce the deploy window this repo has
 * been bitten by before: Vercel and the migration race on merge to main, so
 * for a few minutes the new code runs against the OLD table. PostgREST
 * refuses an INSERT that names a column its schema cache has never heard of,
 * and the failure mode is a Stripe webhook that 500s on every delivery —
 * strictly worse than the race being fixed.
 */
let opportunitiesHasSourceEventId = true

type PgError = { code: string; message: string; details: string | null; hint: string | null }

function uniqueViolation(constraint: string): PgError {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint "${constraint}"`,
    details: null,
    hint: null,
  }
}

/**
 * The `opportunities` constraints that actually exist in Postgres, enforced
 * by this store so a test can prove something about them.
 *
 * This is the whole point of the race test below: a store that accepts every
 * insert is green whether or not `lib/db/pipeline.ts` claims the source id
 * atomically, which is exactly the "test that cannot fail" trap this repo has
 * already shipped once. Both indexes are transcribed from the migrations
 * rather than paraphrased:
 *
 *  - 00219 `opportunities_one_open_per_contact_pipeline`
 *      UNIQUE (contact_id, pipeline_id) WHERE outcome IS NULL
 *      — note it is NOT scoped by business_id, matching the real index.
 *  - 00225 `opportunities_source_event_uniq`
 *      UNIQUE (business_id, source_event_id) WHERE source_event_id IS NOT NULL
 */
function constraintViolation(table: string, payload: Row, rows: Row[]): PgError | null {
  if (table !== "opportunities") return null

  if (!opportunitiesHasSourceEventId && "source_event_id" in payload) {
    // PostgREST's schema-cache miss on a write. Nothing is inserted.
    return {
      code: "PGRST204",
      message: "Could not find the 'source_event_id' column of 'opportunities' in the schema cache",
      details: null,
      hint: null,
    }
  }

  if (
    payload.source_event_id != null &&
    rows.some((r) => r.business_id === payload.business_id && r.source_event_id === payload.source_event_id)
  ) {
    return uniqueViolation("opportunities_source_event_uniq")
  }

  if (
    payload.outcome == null &&
    rows.some((r) => r.outcome == null && r.contact_id === payload.contact_id && r.pipeline_id === payload.pipeline_id)
  ) {
    return uniqueViolation("opportunities_one_open_per_contact_pipeline")
  }

  return null
}

// NOTE ON THE MOCK: copied (structure verbatim) from __tests__/db/sequences.ts's
// harness. The trap this project has hit twice is a `.eq()` that returns the
// query object without recording the filter, so every query resolves to
// "everything in the table" and every assertion passes without ever
// exercising the real filtering logic. This mock tracks every applied
// `.eq()`/`.gte()`/`.lt()` filter and narrows the row set for real.
//
// Step 6 of task-4-brief.md exists to prove that claim rather than assert it:
// see task-4-report.md for the observed (correctly failing) output after
// deleting readMostRecentOpportunity's `.eq("contact_id", …)` filter, and the
// revert that followed.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: keyof Store) => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      const gteFilters: Array<[string, any]> = []
      const ltFilters: Array<[string, any]> = []
      let orderCol: string | null = null
      let orderAscending = true
      let limitN: number | null = null
      let mode: "select" | "insert" | "update" = "select"
      let payload: Row | null = null

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) &&
        gteFilters.every(([col, val]) => row[col] >= val) &&
        ltFilters.every(([col, val]) => row[col] < val)

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
        const violation = constraintViolation(String(table), p, rows)
        if (violation) return { data: null, error: violation }
        const row: Row = {
          ...p,
          id: p.id ?? nextId(String(table)),
          created_at: p.created_at ?? new Date().toISOString(),
          updated_at: p.updated_at ?? new Date().toISOString(),
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

import {
  applyPipelineEvent,
  moveOpportunityManually,
  readBoard,
  resolvePipeline,
  readMostRecentOpportunity,
  readMostRecentWonOpportunity,
  PipelineNotConfiguredError,
  DEFAULT_PIPELINE_KEY,
} from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { REBOOKING_SUPPRESSION_DAYS } from "@/lib/lead-engine/pipeline-move"

const DAY_MS = 86_400_000

/**
 * A manual close recent enough that `decideMove` still suppresses a
 * re-booking. Derived from the window rather than written as a literal
 * number of days: a hardcoded "5 days ago" is inside a 30-day window and
 * outside a 3-day one, so the day the constant ever moves, a test written to
 * prove a refusal quietly starts proving a creation — and stays green.
 */
const INSIDE_SUPPRESSION_WINDOW = () => new Date(Date.now() - (REBOOKING_SUPPRESSION_DAYS / 2) * DAY_MS).toISOString()

beforeEach(() => {
  store.pipelines = []
  store.pipeline_stages = []
  store.opportunities = []
  store.opportunity_stage_events = []
  store.contacts = []
  store.audit_logs = []
  seqCounter = 0
  opportunitiesHasSourceEventId = true
})

// ---------------------------------------------------------------------------
// Fixtures: one seeded board matching migration 00219's real seed.
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
    email: "lead@example.com",
    phone_e164: null,
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

function stageEventsFor(opportunityId: string): Row[] {
  return store.opportunity_stage_events.filter((e) => e.opportunity_id === opportunityId)
}

// ---------------------------------------------------------------------------

describe("resolvePipeline", () => {
  it("throws PipelineNotConfiguredError when the board has not been seeded", async () => {
    // Nothing seeded.
    await expect(resolvePipeline("coaching", SINGLETON_BUSINESS_ID)).rejects.toThrow(PipelineNotConfiguredError)
  })

  it("throws PipelineNotConfiguredError when the pipeline exists but has no stages", async () => {
    store.pipelines.push({ id: "pipe-empty", business_id: SINGLETON_BUSINESS_ID, key: "empty", name: "Empty" })
    await expect(resolvePipeline("empty", SINGLETON_BUSINESS_ID)).rejects.toThrow(PipelineNotConfiguredError)
  })

  it("returns stages ordered by position", async () => {
    seedBoard()
    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    expect(stages.map((s) => s.key)).toEqual(["consult_booked", "consulted", "won", "lost"])
  })

  // The mock's `.select()` (above) ignores the column list and returns whole
  // rows regardless of what was asked for — real Supabase does not. This test
  // exists so a `name` column dropped from the real SELECT string still fails
  // here even though the mock itself wouldn't catch it: it pins the exact
  // mapped values, not just that the field is present.
  it("carries the configured stage name, not a key-derived one", async () => {
    seedBoard()
    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    expect(stages.map((s) => s.name)).toEqual(["Consult Booked", "Consulted", "Won", "Lost"])
  })
})

describe("readMostRecentOpportunity", () => {
  // Final review, Critical 2. Reproduces the contested-merge scenario: two
  // contacts, each with their own open card, merge (migration 00220). The
  // merge CTE keeps whichever card is FURTHER ALONG, tie-broken by earlier
  // created_at — so on a tie in stage position, the OLDER card survives open
  // and the NEWER one is closed `lost`/`merged_into_survivor`. A bare
  // `ORDER BY created_at DESC LIMIT 1` would therefore return the newer,
  // permanently CLOSED card forever, stranding the genuinely open survivor.
  it("prefers the open card over a newer closed one after a contested merge", async () => {
    seedBoard()
    seedContact("c-1")

    // Older card — the survivor of the merge tie-break, still open.
    seedOpportunity("opp-old-open", "c-1", {
      stage_id: "stage-consult-booked",
      created_at: new Date(Date.now() - 5 * DAY_MS).toISOString(),
      outcome: null,
    })
    // Newer card — the merge LOSER, closed by the 00220 CTE. Newer
    // created_at is exactly what makes plain "most recent" pick this one.
    seedOpportunity("opp-new-closed", "c-1", {
      stage_id: "stage-lost",
      created_at: new Date().toISOString(),
      outcome: "lost",
      outcome_reason: "merged_into_survivor",
      closed_trigger: "merge",
      closed_at: new Date().toISOString(),
    })

    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    const current = await readMostRecentOpportunity("c-1", "pipe-1", stages, SINGLETON_BUSINESS_ID)

    expect(current?.id).toBe("opp-old-open")
    expect(current?.outcome).toBeNull()
  })

  // No open card at all: falls back to the most recently closed one,
  // preserving the pre-fix behavior for the common (non-contested) case.
  it("falls back to the most recent closed card when the contact has no open card", async () => {
    seedBoard()
    seedContact("c-1")

    seedOpportunity("opp-older-lost", "c-1", {
      stage_id: "stage-lost",
      created_at: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      outcome: "lost",
      closed_at: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      closed_trigger: "booking",
    })
    seedOpportunity("opp-newer-won", "c-1", {
      stage_id: "stage-won",
      created_at: new Date().toISOString(),
      outcome: "won",
      closed_at: new Date().toISOString(),
      closed_trigger: "payment",
    })

    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    const current = await readMostRecentOpportunity("c-1", "pipe-1", stages, SINGLETON_BUSINESS_ID)

    expect(current?.id).toBe("opp-newer-won")
  })
})

describe("readMostRecentWonOpportunity", () => {
  it("returns null when the contact has no Won opportunity", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    const won = await readMostRecentWonOpportunity("c-1", "pipe-1", stages, SINGLETON_BUSINESS_ID)

    expect(won).toBeNull()
  })

  it("finds the Won opportunity even when a newer non-Won card exists", async () => {
    seedBoard()
    seedContact("c-1")

    seedOpportunity("opp-won", "c-1", {
      stage_id: "stage-won",
      outcome: "won",
      value_cents: 90000,
      closed_at: new Date(Date.now() - 5 * DAY_MS).toISOString(),
      closed_trigger: "payment",
    })
    // A newer open card (e.g. a re-booking after the suppression window
    // lapsed) — readMostRecentOpportunity would prefer THIS one, but a
    // refund must still find the Won card specifically.
    seedOpportunity("opp-new-open", "c-1", {
      stage_id: "stage-consult-booked",
      created_at: new Date().toISOString(),
    })

    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    const won = await readMostRecentWonOpportunity("c-1", "pipe-1", stages, SINGLETON_BUSINESS_ID)

    expect(won?.id).toBe("opp-won")
    expect(won?.value_cents).toBe(90000)
  })

  it("picks the more recently closed of two Won opportunities", async () => {
    seedBoard()
    seedContact("c-1")

    seedOpportunity("opp-won-older", "c-1", {
      stage_id: "stage-won",
      outcome: "won",
      value_cents: 50000,
      closed_at: new Date(Date.now() - 20 * DAY_MS).toISOString(),
      closed_trigger: "payment",
    })
    seedOpportunity("opp-won-newer", "c-1", {
      stage_id: "stage-won",
      outcome: "won",
      value_cents: 70000,
      closed_at: new Date(Date.now() - 1 * DAY_MS).toISOString(),
      closed_trigger: "payment",
    })

    const { stages } = await resolvePipeline("coaching", SINGLETON_BUSINESS_ID)
    const won = await readMostRecentWonOpportunity("c-1", "pipe-1", stages, SINGLETON_BUSINESS_ID)

    expect(won?.id).toBe("opp-won-newer")
  })
})

describe("applyPipelineEvent", () => {
  it("creates a card in the first open stage on booking.scheduled", async () => {
    seedBoard()
    seedContact("c-1")

    const { decision, opportunityId } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("create")
    expect(opportunityId).not.toBeNull()
    expect(store.opportunities).toHaveLength(1)
    expect(store.opportunities[0].stage_id).toBe("stage-consult-booked")
    expect(store.opportunities[0].contact_id).toBe("c-1")

    const created = store.audit_logs.find((a) => a.action === "pipeline.opportunity_created")
    expect(created).toBeDefined()
    expect(created?.category).toBe("automation")
  })

  it("writes an opportunity_stage_events row with trigger='booking' and from_stage_id=null on creation", async () => {
    seedBoard()
    seedContact("c-1")

    const { opportunityId } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
    })

    const events = stageEventsFor(opportunityId as string)
    expect(events).toHaveLength(1)
    expect(events[0].trigger).toBe("booking")
    expect(events[0].from_stage_id).toBeNull()
    expect(events[0].to_stage_id).toBe("stage-consult-booked")
  })

  it("copies contacts.first_touch_session_id into source_session_id at creation", async () => {
    seedBoard()
    seedContact("c-1", { first_touch_session_id: "sess-abc" })

    await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
    })

    expect(store.opportunities[0].source_session_id).toBe("sess-abc")
  })

  it("does NOT update source_session_id on a later move", async () => {
    seedBoard()
    seedContact("c-1", { first_touch_session_id: "sess-changed-since" })
    seedOpportunity("opp-1", "c-1", {
      stage_id: "stage-consult-booked",
      source_session_id: "sess-original",
    })

    // booking.completed on an existing open card in consult_booked advances
    // it to consulted — it must not re-read the contact's (now different)
    // first_touch_session_id.
    const { decision } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "completed", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("advance")
    expect(store.opportunities[0].source_session_id).toBe("sess-original")
  })

  it("advances an existing card and stamps a fresh entered_stage_at", async () => {
    seedBoard()
    seedContact("c-1")
    const staleEnteredAt = new Date(Date.now() - 10 * DAY_MS).toISOString()
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked", entered_stage_at: staleEnteredAt })

    const before = Date.now()
    const { decision } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "completed", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("advance")
    expect(store.opportunities[0].stage_id).toBe("stage-consulted")
    expect(new Date(store.opportunities[0].entered_stage_at).getTime()).toBeGreaterThanOrEqual(before)
    expect(store.opportunities[0].entered_stage_at).not.toBe(staleEnteredAt)
  })

  it("sets outcome/closed_at/closed_trigger together on a win", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })

    const { decision } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("close")
    const row = store.opportunities[0]
    expect(row.outcome).toBe("won")
    // WHY the card closed. decideMove has always named it; this column (00219)
    // was never written on the close path until the Calendly acceptance run
    // asserted `lost / booking_cancelled` and found `lost / null`.
    expect(row.outcome_reason).toBe("payment_received")
    expect(row.closed_at).not.toBeNull()
    expect(row.closed_trigger).toBe("payment")
    expect(row.stage_id).toBe("stage-won")
    expect(row.value_cents).toBe(50000)
    expect(row.currency).toBe("usd")

    const won = store.audit_logs.find((a) => a.action === "pipeline.opportunity_won")
    expect(won).toBeDefined()
    expect(won?.category).toBe("commerce")
  })

  it("closes lost with outcome_reason booking_cancelled when an open card's consult is cancelled", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

    const { decision } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "cancelled", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("close")
    const row = store.opportunities[0]
    expect(row.outcome).toBe("lost")
    expect(row.outcome_reason).toBe("booking_cancelled")
    expect(row.closed_trigger).toBe("booking")
    expect(row.stage_id).toBe("stage-lost")
  })

  // Controller ruling C3: a `create` decision that ALSO carries an outcome
  // (payment arrives with no prior deal at all) must set closed_at and
  // closed_trigger in the SAME insert, or opportunities_closed_fields_agree
  // rejects the row.
  it("sets outcome/closed_at/closed_trigger together on a create-with-outcome (payment, no prior deal)", async () => {
    seedBoard()
    seedContact("c-1")

    const { decision, opportunityId } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("create")
    expect(store.opportunities).toHaveLength(1)
    const row = store.opportunities[0]
    expect(row.id).toBe(opportunityId)
    expect(row.outcome).toBe("won")
    expect(row.closed_at).not.toBeNull()
    expect(row.closed_trigger).toBe("payment")
    expect(row.stage_id).toBe("stage-won")
    expect(row.value_cents).toBe(12000)
  })

  // Final review, Important 3. The partial unique index only covers
  // `WHERE outcome IS NULL`, so it does NOT protect the create-with-outcome
  // branch above (the row is inserted already closed) — two CONCURRENT
  // checkout.session.completed deliveries for the same contact would both
  // read `current === null` and both reach the `create` branch. This test
  // reproduces the moment that matters: by the time THIS call's create
  // branch runs, another delivery of the SAME Stripe session has already
  // recorded its stage event (the metadata check reads it back) — the exact
  // ledger a genuinely concurrent duplicate would have written. Two
  // deliveries of the same session id must produce exactly one card.
  it("refuses to create a second card when the source id is already recorded on a stage event", async () => {
    seedBoard()
    seedContact("c-1")

    // Stands in for the OTHER concurrent delivery, which already won its own
    // card (for whichever contact/opportunity — the check is keyed on the
    // source id alone, not on opportunity) and recorded this stage event.
    store.opportunity_stage_events.push({
      id: nextId("event"),
      business_id: SINGLETON_BUSINESS_ID,
      opportunity_id: "opp-from-other-delivery",
      from_stage_id: null,
      to_stage_id: "stage-won",
      trigger: "payment",
      actor_user_id: null,
      refused_reason: null,
      metadata: { stripe_session_id: "cs_test_dup_1" },
      occurred_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      _seq: store.opportunity_stage_events.length,
    })

    const { decision, opportunityId } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
      metadata: { stripe_session_id: "cs_test_dup_1" },
    })

    expect(decision.kind).toBe("noop")
    expect(opportunityId).toBeNull()
    expect(store.opportunities).toHaveLength(0) // no duplicate card created
  })

  // Confirms the check is keyed on the metadata VALUE, not just presence —
  // a different session id must still create normally.
  it("still creates a card when metadata carries a DIFFERENT source id", async () => {
    seedBoard()
    seedContact("c-1")

    store.opportunity_stage_events.push({
      id: nextId("event"),
      business_id: SINGLETON_BUSINESS_ID,
      opportunity_id: "opp-from-other-delivery",
      from_stage_id: null,
      to_stage_id: "stage-won",
      trigger: "payment",
      actor_user_id: null,
      refused_reason: null,
      metadata: { stripe_session_id: "cs_totally_different" },
      occurred_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      _seq: store.opportunity_stage_events.length,
    })

    const { decision } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
      metadata: { stripe_session_id: "cs_test_dup_1" },
    })

    expect(decision.kind).toBe("create")
    expect(store.opportunities).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Migration 00225 — opportunities.source_event_id.
  //
  // The metadata pre-check above is a SELECT, then an INSERT into
  // opportunities, then an INSERT into opportunity_stage_events: three
  // round-trips, no transaction. Two Stripe deliveries of the same checkout
  // session that interleave inside that gap both read "no duplicate" and both
  // create a card — two Won cards for one sale, double-counted in the
  // campaign revenue report. These tests drive that interleaving for real
  // (Promise.all over the actual entry point, not the helper) and pin the
  // claim to the same INSERT as the effect.
  // -------------------------------------------------------------------------
  describe("source_event_id claims the sale in the same insert (00225)", () => {
    /**
     * Two concurrent create-with-outcome calls for one checkout session.
     *
     * `Promise.all` over `applyPipelineEvent` interleaves them in lockstep —
     * both resolve the board, both read `current === null`, and both clear
     * the metadata pre-check (neither has written a stage event yet) before
     * either reaches the insert. That is the exact window the pre-check
     * cannot close, reproduced through the real code path.
     */
    it("mints exactly ONE card when two deliveries of the same session race", async () => {
      seedBoard()
      seedContact("c-1")

      const payment = {
        kind: "payment" as const,
        amountCents: 120000,
        currency: "usd",
        occurredAt: new Date(),
      }
      const [first, second] = await Promise.all([
        applyPipelineEvent({
          businessId: SINGLETON_BUSINESS_ID,
          contactId: "c-1",
          event: payment,
          metadata: { stripe_session_id: "cs_race_1" },
        }),
        applyPipelineEvent({
          businessId: SINGLETON_BUSINESS_ID,
          contactId: "c-1",
          event: payment,
          metadata: { stripe_session_id: "cs_race_1" },
        }),
      ])

      expect(store.opportunities).toHaveLength(1)
      expect(store.opportunities[0].source_event_id).toBe("cs_race_1")

      const kinds = [first.decision.kind, second.decision.kind].sort()
      expect(kinds).toEqual(["create", "noop"])

      const loser = first.decision.kind === "noop" ? first : second
      expect(loser.decision).toEqual({ kind: "noop", reason: "duplicate_source_id" })
      expect(loser.opportunityId).toBeNull()

      // The winner's card is a real, complete Won row — the loser did not
      // half-write anything over it.
      const won = store.opportunities[0]
      expect(won.outcome).toBe("won")
      expect(won.value_cents).toBe(120000)
      // ...and exactly one stage event, so the revenue report counts one sale.
      expect(store.opportunity_stage_events).toHaveLength(1)
    })

    /**
     * The column is opt-in, exactly like the metadata pre-check it backs up.
     * A caller that passes no source id gets today's behaviour unchanged —
     * the partial index says `WHERE source_event_id IS NOT NULL`, so two null
     * rows never collide. Pinning this stops the fix from quietly becoming a
     * global "one Won card per contact ever" rule.
     */
    it("still allows two cards when the caller passes no source id at all", async () => {
      seedBoard()
      seedContact("c-1")

      const payment = {
        kind: "payment" as const,
        amountCents: 5000,
        currency: "usd",
        occurredAt: new Date(),
      }
      const [first, second] = await Promise.all([
        applyPipelineEvent({ businessId: SINGLETON_BUSINESS_ID, contactId: "c-1", event: payment }),
        applyPipelineEvent({ businessId: SINGLETON_BUSINESS_ID, contactId: "c-1", event: payment }),
      ])

      expect(first.decision.kind).toBe("create")
      expect(second.decision.kind).toBe("create")
      expect(store.opportunities).toHaveLength(2)
      expect(store.opportunities.every((o) => o.source_event_id == null)).toBe(true)
    })

    it("claims a reconciler payment replay under payment_id", async () => {
      seedBoard()
      seedContact("c-1")

      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "payment", amountCents: 9900, currency: "usd", occurredAt: new Date() },
        source: "reconciler",
        metadata: { payment_id: "pay-42" },
      })

      expect(store.opportunities[0].source_event_id).toBe("pay-42")
    })

    it("claims a reconciler booking replay under booking_id", async () => {
      seedBoard()
      seedContact("c-1")

      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
        source: "reconciler",
        metadata: { booking_id: "bk-42" },
      })

      expect(store.opportunities[0].source_event_id).toBe("bk-42")
    })

    // Assert WHICH id was chosen, not merely that one was. No caller passes
    // two of these today, so the order is a determinism guarantee rather than
    // a live tie-break — but "whatever Object.keys happened to yield first"
    // is not a guarantee, and a second card hangs on it.
    it("prefers the checkout session id over the reconciler's ids", async () => {
      seedBoard()
      seedContact("c-1")

      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "payment", amountCents: 9900, currency: "usd", occurredAt: new Date() },
        metadata: { payment_id: "pay-7", booking_id: "bk-7", stripe_session_id: "cs_wins" },
      })

      expect(store.opportunities[0].source_event_id).toBe("cs_wins")
    })

    // Non-string metadata is not an id. Left null rather than coerced: every
    // coerced value would collide with every other coerced value under a
    // UNIQUE index, so `String(undefined)` would refuse a second, unrelated
    // sale outright.
    it("ignores a non-string source id", async () => {
      seedBoard()
      seedContact("c-1")

      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "payment", amountCents: 9900, currency: "usd", occurredAt: new Date() },
        metadata: { stripe_session_id: 12345, amount_refunded: 0 },
      })

      expect(store.opportunities).toHaveLength(1)
      expect(store.opportunities[0].source_event_id == null).toBe(true)
    })

    /**
     * THE deploy-window test. Migrations and the Vercel build race on merge
     * to main, so this code will run for a few minutes against an
     * `opportunities` table with no `source_event_id` column. PostgREST
     * answers PGRST204 to an INSERT naming a column it does not know — which,
     * unhandled, is a Stripe webhook that 500s on every single delivery for
     * as long as the window lasts. That is a worse outcome than the race
     * being fixed, so the sale must still land, just without the claim.
     */
    it("still records the sale when the 00225 column has not landed yet", async () => {
      seedBoard()
      seedContact("c-1")
      opportunitiesHasSourceEventId = false
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})

      try {
        const { decision, opportunityId } = await applyPipelineEvent({
          businessId: SINGLETON_BUSINESS_ID,
          contactId: "c-1",
          event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
          metadata: { stripe_session_id: "cs_pre_migration" },
        })

        expect(decision.kind).toBe("create")
        expect(opportunityId).not.toBeNull()
        expect(store.opportunities).toHaveLength(1)
        const row = store.opportunities[0]
        expect(row.outcome).toBe("won")
        expect(row.value_cents).toBe(12000)
        // The retry dropped the field entirely rather than sending a null for a
        // column PostgREST cannot see.
        expect("source_event_id" in row).toBe(false)
        // And the sale is still traceable: the stage event carries the session
        // id regardless of the column, which is what the pre-check reads back.
        // The marker beside it is the point — see the next assertion.
        expect(stageEventsFor(opportunityId as string)[0].metadata).toEqual({
          stripe_session_id: "cs_pre_migration",
          source_event_id_claimed: false,
        })
        // Degrading QUIETLY is the failure this guards against. The return
        // value on this path is identical to the protected one, so without a
        // log line and a queryable marker the only symptom of the protection
        // being off is duplicated revenue noticed weeks later.
        expect(errors).toHaveBeenCalledWith(
          expect.stringContaining("duplicate-sale protection is OFF"),
          expect.objectContaining({ sourceEventId: "cs_pre_migration" }),
        )
      } finally {
        errors.mockRestore()
      }
    })

    it("leaves the marker OFF when the column is present, so its absence keeps meaning something", async () => {
      seedBoard()
      seedContact("c-1")

      const { opportunityId } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
        metadata: { stripe_session_id: "cs_normal" },
      })

      expect(stageEventsFor(opportunityId as string)[0].metadata).toEqual({ stripe_session_id: "cs_normal" })
    })

    /**
     * A unique violation is not automatically "someone else claimed this
     * source id" — `opportunities_one_open_per_contact_pipeline` raises the
     * same 23505, and that one means a genuine concurrency fault the
     * reconciler counts as `failed` and logs. Swallowing every 23505 into a
     * silent noop would hide it.
     *
     * The competing open card is seeded under a DIFFERENT business_id, which
     * is not a contrivance: 00219's open-card index is keyed on
     * (contact_id, pipeline_id) with no business_id, while
     * `readMostRecentOpportunity` does filter by business — so this row is
     * invisible to the read and still fatal to the insert.
     */
    it("rethrows a unique violation that did NOT come from the source-id claim", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-other-tenant", "c-1", { business_id: "biz-2", outcome: null })

      await expect(
        applyPipelineEvent({
          businessId: SINGLETON_BUSINESS_ID,
          contactId: "c-1",
          event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
          source: "reconciler",
          metadata: { booking_id: "bk-99" },
        }),
      ).rejects.toMatchObject({ code: "23505" })
    })
  })

  it("records a refused event with refused_reason and does not move the card", async () => {
    seedBoard()
    seedContact("c-1")
    const recentClose = INSIDE_SUPPRESSION_WINDOW()
    seedOpportunity("opp-1", "c-1", {
      stage_id: "stage-lost",
      outcome: "lost",
      closed_trigger: "manual",
      closed_at: recentClose,
      closed_by_user_id: "admin-1",
    })

    const { decision, opportunityId } = await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("refuse")
    expect(opportunityId).toBe("opp-1")
    // No new card, and the existing one did not move.
    expect(store.opportunities).toHaveLength(1)
    expect(store.opportunities[0].stage_id).toBe("stage-lost")
    expect(store.opportunities[0].outcome).toBe("lost")

    const events = stageEventsFor("opp-1")
    expect(events).toHaveLength(1)
    expect(events[0].refused_reason).toBe("suppressed_after_manual_lost")
    expect(events[0].from_stage_id).toBe("stage-lost")
    expect(events[0].to_stage_id).toBeNull()
  })

  it("is scoped to the right contact — a second contact's card is untouched", async () => {
    seedBoard()
    seedContact("c-1")
    seedContact("c-2")
    const untouchedEnteredAt = new Date(Date.now() - 2 * DAY_MS).toISOString()
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })
    seedOpportunity("opp-2", "c-2", { stage_id: "stage-consult-booked", entered_stage_at: untouchedEnteredAt })

    await applyPipelineEvent({
      businessId: SINGLETON_BUSINESS_ID,
      contactId: "c-1",
      event: { kind: "booking", status: "completed", occurredAt: new Date() },
    })

    const oppTwo = store.opportunities.find((o) => o.id === "opp-2")!
    expect(oppTwo.stage_id).toBe("stage-consult-booked")
    expect(oppTwo.entered_stage_at).toBe(untouchedEnteredAt)
    expect(stageEventsFor("opp-2")).toHaveLength(0)
  })

  // Controller ruling C1: source: "reconciler" relabels ONLY the stage
  // event's trigger column. opportunities.closed_trigger must stay the
  // decision's real trigger — decideMove reads it (=== 'manual') to decide
  // whether a close is final, and a reconciler replay must not corrupt that.
  describe("source: reconciler (ruling C1)", () => {
    it("writes trigger='reconciler' on the stage event but keeps the real trigger on closed_trigger", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })

      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "payment", amountCents: 9900, currency: "usd", occurredAt: new Date() },
        source: "reconciler",
      })

      const events = stageEventsFor("opp-1")
      expect(events).toHaveLength(1)
      expect(events[0].trigger).toBe("reconciler")
      expect(store.opportunities[0].closed_trigger).toBe("payment")
    })

    it("defaults to source: hook, which writes the decision's own trigger", async () => {
      seedBoard()
      seedContact("c-1")

      const { opportunityId } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
      })

      expect(stageEventsFor(opportunityId as string)[0].trigger).toBe("booking")
    })
  })

  // Spec §14 — a refund reopens nothing but corrects value_cents so the
  // campaign-to-revenue report (§7) self-heals instead of overstating what a
  // refunded deal actually earned.
  describe("refunds (spec §14)", () => {
    it("a full refund zeroes value_cents, sets outcome_reason='refunded', and does not move the stage", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", {
        stage_id: "stage-won",
        outcome: "won",
        value_cents: 120000,
        closed_at: new Date().toISOString(),
        closed_trigger: "payment",
      })

      const { decision, opportunityId } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 120000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_full_1", amount_refunded: 120000 },
      })

      expect(decision).toMatchObject({ kind: "amend", valueCents: 0, outcomeReason: "refunded" })
      expect(opportunityId).toBe("opp-1")
      const row = store.opportunities[0]
      expect(row.value_cents).toBe(0)
      expect(row.outcome_reason).toBe("refunded")
      expect(row.outcome).toBe("won") // card stays Won — refund reopens nothing
      expect(row.stage_id).toBe("stage-won") // no stage change

      const events = stageEventsFor("opp-1")
      expect(events).toHaveLength(1)
      expect(events[0].from_stage_id).toBe("stage-won")
      expect(events[0].to_stage_id).toBe("stage-won")
      expect(events[0].metadata).toMatchObject({ stripe_charge_id: "ch_full_1", amount_refunded: 120000 })
    })

    it("a partial refund subtracts and sets outcome_reason='partially_refunded'", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", {
        stage_id: "stage-won",
        outcome: "won",
        value_cents: 120000,
        closed_at: new Date().toISOString(),
        closed_trigger: "payment",
      })

      const { decision } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 10000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_partial_1", amount_refunded: 10000 },
      })

      expect(decision).toMatchObject({ kind: "amend", valueCents: 110000, outcomeReason: "partially_refunded" })
      const row = store.opportunities[0]
      expect(row.value_cents).toBe(110000)
      expect(row.outcome_reason).toBe("partially_refunded")
      expect(row.outcome).toBe("won")
    })

    it("an over-refund clamps value_cents at 0 rather than going negative", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", {
        stage_id: "stage-won",
        outcome: "won",
        value_cents: 5000,
        closed_at: new Date().toISOString(),
        closed_trigger: "payment",
      })

      const { decision } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 999999, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_over_1", amount_refunded: 999999 },
      })

      expect(decision).toMatchObject({ kind: "amend", valueCents: 0, outcomeReason: "refunded" })
      expect(store.opportunities[0].value_cents).toBe(0)
    })

    it("a refund for a contact with no Won card does nothing and does not throw", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" }) // open, not Won

      const { decision, opportunityId } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 5000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_nowon_1", amount_refunded: 5000 },
      })

      expect(decision).toEqual({ kind: "noop", reason: "no_won_opportunity" })
      expect(opportunityId).toBeNull()
      // The open card was left completely alone.
      expect(store.opportunities[0].value_cents).toBeNull()
      expect(stageEventsFor("opp-1")).toHaveLength(0)
    })

    // Highest-risk case: Stripe delivers at-least-once. A second delivery of
    // the SAME refund (same charge, same cumulative amount_refunded) must
    // not subtract twice.
    it("a second delivery of the same refund changes nothing (idempotent)", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", {
        stage_id: "stage-won",
        outcome: "won",
        value_cents: 120000,
        closed_at: new Date().toISOString(),
        closed_trigger: "payment",
      })

      const first = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 10000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_dup_1", amount_refunded: 10000 },
      })
      expect(first.decision.kind).toBe("amend")
      expect(store.opportunities[0].value_cents).toBe(110000)

      // Stripe retries the identical webhook delivery.
      const second = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 10000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_dup_1", amount_refunded: 10000 },
      })

      expect(second.decision).toEqual({ kind: "noop", reason: "refund_already_applied" })
      expect(store.opportunities[0].value_cents).toBe(110000) // unchanged — not 100000
      expect(stageEventsFor("opp-1")).toHaveLength(1) // no second event written
    })

    // A genuinely NEW partial refund on the same charge (Stripe's
    // amount_refunded is cumulative) must apply only the delta on top of
    // what a prior delivery already recorded.
    it("a second, genuinely new partial refund on the same charge applies only the delta", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", {
        stage_id: "stage-won",
        outcome: "won",
        value_cents: 120000,
        closed_at: new Date().toISOString(),
        closed_trigger: "payment",
      })

      // First partial refund: 10000 off.
      await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 10000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_accum_1", amount_refunded: 10000 },
      })
      expect(store.opportunities[0].value_cents).toBe(110000)

      // A later, additional partial refund on the SAME charge — Stripe now
      // reports the cumulative total (25000), not just the new increment.
      const { decision } = await applyPipelineEvent({
        businessId: SINGLETON_BUSINESS_ID,
        contactId: "c-1",
        event: { kind: "refund", amountRefundedCents: 25000, occurredAt: new Date() },
        metadata: { stripe_charge_id: "ch_accum_1", amount_refunded: 25000 },
      })

      expect(decision).toMatchObject({ kind: "amend", valueCents: 95000, outcomeReason: "partially_refunded" })
      expect(store.opportunities[0].value_cents).toBe(95000) // 120000 - 25000, NOT 120000 - 10000 - 25000
      expect(stageEventsFor("opp-1")).toHaveLength(2)
    })
  })
})

describe("readBoard", () => {
  it("returns one column per stage in position order", async () => {
    seedBoard()

    const board = await readBoard(undefined, SINGLETON_BUSINESS_ID)

    expect(board.map((c) => c.stage.key)).toEqual(["consult_booked", "consulted", "won", "lost"])
  })

  it("computes staleness at read time and stores nothing", async () => {
    seedBoard()
    seedContact("c-1")
    const redEnteredAt = new Date(Date.now() - 8 * DAY_MS).toISOString() // red_after_days=7
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked", entered_stage_at: redEnteredAt })

    const board = await readBoard(undefined, SINGLETON_BUSINESS_ID)

    const column = board.find((c) => c.stage.key === "consult_booked")!
    expect(column.cards).toHaveLength(1)
    expect(column.cards[0].staleness).toBe("red")
    // Nothing was written back to the row to persist that verdict.
    expect(store.opportunities[0].staleness).toBeUndefined()
  })

  it("omits closed cards from open columns", async () => {
    seedBoard()
    seedContact("c-open")
    seedContact("c-stuck-closed")
    seedContact("c-won")

    // A legitimately open card in consult_booked.
    seedOpportunity("opp-open", "c-open", { stage_id: "stage-consult-booked" })
    // A closed-outcome row whose stage_id still points at an open stage
    // (the inconsistent state readBoard must defend against).
    seedOpportunity("opp-stuck", "c-stuck-closed", {
      stage_id: "stage-consult-booked",
      outcome: "won",
      closed_at: new Date().toISOString(),
      closed_trigger: "payment",
    })
    // A legitimately closed-won card sitting in the won stage.
    seedOpportunity("opp-won", "c-won", {
      stage_id: "stage-won",
      outcome: "won",
      closed_at: new Date().toISOString(),
      closed_trigger: "payment",
    })

    const board = await readBoard(undefined, SINGLETON_BUSINESS_ID)

    const openColumn = board.find((c) => c.stage.key === "consult_booked")!
    expect(openColumn.cards.map((c) => c.id)).toEqual(["opp-open"])

    const wonColumn = board.find((c) => c.stage.key === "won")!
    expect(wonColumn.cards.map((c) => c.id)).toEqual(["opp-won"])
  })

  it("carries the contact's name and value onto the card", async () => {
    seedBoard()
    seedContact("c-1", { name: "Jane Doe" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked", value_cents: 25000 })

    const board = await readBoard(undefined, SINGLETON_BUSINESS_ID)
    const card = board.find((c) => c.stage.key === "consult_booked")!.cards[0]

    expect(card.contactName).toBe("Jane Doe")
    expect(card.valueCents).toBe(25000)
    expect(card.contactId).toBe("c-1")
  })
})

describe("moveOpportunityManually", () => {
  it("sets closed_trigger='manual' and closed_by_user_id when moving into a won/lost stage", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })

    await moveOpportunityManually({
      opportunityId: "opp-1",
      toStageKey: "won",
      actorUserId: "admin-1",
      businessId: SINGLETON_BUSINESS_ID,
    })

    const row = store.opportunities[0]
    expect(row.stage_id).toBe("stage-won")
    expect(row.outcome).toBe("won")
    expect(row.closed_trigger).toBe("manual")
    expect(row.closed_by_user_id).toBe("admin-1")
    expect(row.closed_at).not.toBeNull()

    const events = stageEventsFor("opp-1")
    expect(events).toHaveLength(1)
    expect(events[0].trigger).toBe("manual")
    expect(events[0].actor_user_id).toBe("admin-1")

    const moved = store.audit_logs.find((a) => a.action === "pipeline.opportunity_moved")
    expect(moved).toBeDefined()
    expect(moved?.category).toBe("admin_write")
  })

  it("does not set closed_trigger/closed_by_user_id when moving between open stages", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

    await moveOpportunityManually({
      opportunityId: "opp-1",
      toStageKey: "consulted",
      actorUserId: "admin-1",
      businessId: SINGLETON_BUSINESS_ID,
    })

    const row = store.opportunities[0]
    expect(row.stage_id).toBe("stage-consulted")
    expect(row.outcome).toBeNull()
    expect(row.closed_trigger).toBeNull()
    expect(row.closed_by_user_id).toBeNull()
  })

  it("clears closure fields together when a closed card is moved back onto an open stage", async () => {
    seedBoard()
    seedContact("c-1")
    seedOpportunity("opp-1", "c-1", {
      stage_id: "stage-lost",
      outcome: "lost",
      closed_at: new Date().toISOString(),
      closed_trigger: "manual",
      closed_by_user_id: "admin-1",
    })

    await moveOpportunityManually({
      opportunityId: "opp-1",
      toStageKey: "consult_booked",
      actorUserId: "admin-2",
      businessId: SINGLETON_BUSINESS_ID,
    })

    const row = store.opportunities[0]
    expect(row.stage_id).toBe("stage-consult-booked")
    expect(row.outcome).toBeNull()
    expect(row.closed_at).toBeNull()
    expect(row.closed_trigger).toBeNull()
    expect(row.closed_by_user_id).toBeNull()
  })

  // Controller ruling (fix round 1): a manual close must dual-log. _moved
  // (admin_write) records who did it; _won/_lost (commerce) records what
  // happened. A reader that counts won deals off the commerce category must
  // see a manual close exactly like an automated one.
  describe("audit dual-logging on a manual close (ruling 1)", () => {
    it("emits BOTH pipeline.opportunity_moved and pipeline.opportunity_won when moving into the won stage", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", { stage_id: "stage-consulted" })

      await moveOpportunityManually({
        opportunityId: "opp-1",
        toStageKey: "won",
        actorUserId: "admin-1",
        businessId: SINGLETON_BUSINESS_ID,
      })

      const actions = store.audit_logs.map((a) => a.action)
      expect(actions).toContain("pipeline.opportunity_moved")
      expect(actions).toContain("pipeline.opportunity_won")
      expect(actions).not.toContain("pipeline.opportunity_lost")

      const won = store.audit_logs.find((a) => a.action === "pipeline.opportunity_won")!
      expect(won.category).toBe("commerce")
    })

    it("emits BOTH pipeline.opportunity_moved and pipeline.opportunity_lost when moving into the lost stage", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

      await moveOpportunityManually({
        opportunityId: "opp-1",
        toStageKey: "lost",
        actorUserId: "admin-1",
        businessId: SINGLETON_BUSINESS_ID,
      })

      const actions = store.audit_logs.map((a) => a.action)
      expect(actions).toContain("pipeline.opportunity_moved")
      expect(actions).toContain("pipeline.opportunity_lost")
      expect(actions).not.toContain("pipeline.opportunity_won")

      const lost = store.audit_logs.find((a) => a.action === "pipeline.opportunity_lost")!
      expect(lost.category).toBe("commerce")
    })

    it("emits ONLY pipeline.opportunity_moved when moving between two open stages", async () => {
      seedBoard()
      seedContact("c-1")
      seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked" })

      await moveOpportunityManually({
        opportunityId: "opp-1",
        toStageKey: "consulted",
        actorUserId: "admin-1",
        businessId: SINGLETON_BUSINESS_ID,
      })

      const actions = store.audit_logs.map((a) => a.action)
      expect(actions).toEqual(["pipeline.opportunity_moved"])
    })
  })
})
