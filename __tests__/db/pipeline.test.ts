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
  PipelineNotConfiguredError,
  DEFAULT_PIPELINE_KEY,
} from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

const DAY_MS = 86_400_000

beforeEach(() => {
  store.pipelines = []
  store.pipeline_stages = []
  store.opportunities = []
  store.opportunity_stage_events = []
  store.contacts = []
  store.audit_logs = []
  seqCounter = 0
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
    await expect(resolvePipeline("coaching")).rejects.toThrow(PipelineNotConfiguredError)
  })

  it("throws PipelineNotConfiguredError when the pipeline exists but has no stages", async () => {
    store.pipelines.push({ id: "pipe-empty", business_id: SINGLETON_BUSINESS_ID, key: "empty", name: "Empty" })
    await expect(resolvePipeline("empty")).rejects.toThrow(PipelineNotConfiguredError)
  })

  it("returns stages ordered by position", async () => {
    seedBoard()
    const { stages } = await resolvePipeline("coaching")
    expect(stages.map((s) => s.key)).toEqual(["consult_booked", "consulted", "won", "lost"])
  })

  // The mock's `.select()` (above) ignores the column list and returns whole
  // rows regardless of what was asked for — real Supabase does not. This test
  // exists so a `name` column dropped from the real SELECT string still fails
  // here even though the mock itself wouldn't catch it: it pins the exact
  // mapped values, not just that the field is present.
  it("carries the configured stage name, not a key-derived one", async () => {
    seedBoard()
    const { stages } = await resolvePipeline("coaching")
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

    const { stages } = await resolvePipeline("coaching")
    const current = await readMostRecentOpportunity("c-1", "pipe-1", stages)

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

    const { stages } = await resolvePipeline("coaching")
    const current = await readMostRecentOpportunity("c-1", "pipe-1", stages)

    expect(current?.id).toBe("opp-newer-won")
  })
})

describe("applyPipelineEvent", () => {
  it("creates a card in the first open stage on booking.scheduled", async () => {
    seedBoard()
    seedContact("c-1")

    const { decision, opportunityId } = await applyPipelineEvent({
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
      contactId: "c-1",
      event: { kind: "payment", amountCents: 50000, currency: "usd", occurredAt: new Date() },
    })

    expect(decision.kind).toBe("close")
    const row = store.opportunities[0]
    expect(row.outcome).toBe("won")
    expect(row.closed_at).not.toBeNull()
    expect(row.closed_trigger).toBe("payment")
    expect(row.stage_id).toBe("stage-won")
    expect(row.value_cents).toBe(50000)
    expect(row.currency).toBe("usd")

    const won = store.audit_logs.find((a) => a.action === "pipeline.opportunity_won")
    expect(won).toBeDefined()
    expect(won?.category).toBe("commerce")
  })

  // Controller ruling C3: a `create` decision that ALSO carries an outcome
  // (payment arrives with no prior deal at all) must set closed_at and
  // closed_trigger in the SAME insert, or opportunities_closed_fields_agree
  // rejects the row.
  it("sets outcome/closed_at/closed_trigger together on a create-with-outcome (payment, no prior deal)", async () => {
    seedBoard()
    seedContact("c-1")

    const { decision, opportunityId } = await applyPipelineEvent({
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
      contactId: "c-1",
      event: { kind: "payment", amountCents: 12000, currency: "usd", occurredAt: new Date() },
      metadata: { stripe_session_id: "cs_test_dup_1" },
    })

    expect(decision.kind).toBe("create")
    expect(store.opportunities).toHaveLength(1)
  })

  it("records a refused event with refused_reason and does not move the card", async () => {
    seedBoard()
    seedContact("c-1")
    const recentClose = new Date(Date.now() - 5 * DAY_MS).toISOString()
    seedOpportunity("opp-1", "c-1", {
      stage_id: "stage-lost",
      outcome: "lost",
      closed_trigger: "manual",
      closed_at: recentClose,
      closed_by_user_id: "admin-1",
    })

    const { decision, opportunityId } = await applyPipelineEvent({
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
        contactId: "c-1",
        event: { kind: "booking", status: "scheduled", occurredAt: new Date() },
      })

      expect(stageEventsFor(opportunityId as string)[0].trigger).toBe("booking")
    })
  })
})

describe("readBoard", () => {
  it("returns one column per stage in position order", async () => {
    seedBoard()

    const board = await readBoard()

    expect(board.map((c) => c.stage.key)).toEqual(["consult_booked", "consulted", "won", "lost"])
  })

  it("computes staleness at read time and stores nothing", async () => {
    seedBoard()
    seedContact("c-1")
    const redEnteredAt = new Date(Date.now() - 8 * DAY_MS).toISOString() // red_after_days=7
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked", entered_stage_at: redEnteredAt })

    const board = await readBoard()

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

    const board = await readBoard()

    const openColumn = board.find((c) => c.stage.key === "consult_booked")!
    expect(openColumn.cards.map((c) => c.id)).toEqual(["opp-open"])

    const wonColumn = board.find((c) => c.stage.key === "won")!
    expect(wonColumn.cards.map((c) => c.id)).toEqual(["opp-won"])
  })

  it("carries the contact's name and value onto the card", async () => {
    seedBoard()
    seedContact("c-1", { name: "Jane Doe" })
    seedOpportunity("opp-1", "c-1", { stage_id: "stage-consult-booked", value_cents: 25000 })

    const board = await readBoard()
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

    await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "won", actorUserId: "admin-1" })

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

    await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "consulted", actorUserId: "admin-1" })

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

    await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "consult_booked", actorUserId: "admin-2" })

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

      await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "won", actorUserId: "admin-1" })

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

      await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "lost", actorUserId: "admin-1" })

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

      await moveOpportunityManually({ opportunityId: "opp-1", toStageKey: "consulted", actorUserId: "admin-1" })

      const actions = store.audit_logs.map((a) => a.action)
      expect(actions).toEqual(["pipeline.opportunity_moved"])
    })
  })
})
