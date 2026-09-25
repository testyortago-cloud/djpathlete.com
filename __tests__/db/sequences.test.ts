// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, any>

type Store = {
  business_settings: Row[]
  contacts: Row[]
  sequences: Row[]
  sequence_runs: Row[]
  sequence_messages: Row[]
  sequence_steps: Row[]
  contact_consents: Row[]
  contact_suppressions: Row[]
}

const store: Store = {
  business_settings: [],
  contacts: [],
  sequences: [],
  sequence_runs: [],
  sequence_messages: [],
  sequence_steps: [],
  contact_consents: [],
  contact_suppressions: [],
}

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

// When set, the next read against that table (`maybeSingle()` or a bare
// awaited select chain) returns a Postgres-shaped error instead of data, so
// tests can prove a read failure propagates instead of being read as "no
// record" / "not suppressed" / "no consent".
let forceErrorOnTable: string | null = null

let rpcCalls: Array<{ name: string; args: any }> = []
let rpcResult: { data: any; error: any } = { data: [], error: null }

// The row store is select-string-BLIND on purpose (it returns whole seeded
// rows), so an assertion on a context field cannot tell a selected column
// from one the fake handed back for free. Recording the projection is the
// only way a test here can pin that a column is actually asked for.
let selectCalls: Array<{ table: string; columns: string }> = []

// NOTE ON THE MOCK: the trap this project has hit twice is a `.eq()` that
// returns the query object without recording the filter, so every query
// resolves to "everything in the table" and every assertion passes without
// ever exercising the real filtering logic. This mock tracks every applied
// `.eq()`/`.gte()`/`.lt()` filter and narrows the row set for real, the same
// pattern as __tests__/db/contact-consents.test.ts. Before trusting a green
// suite here, the sequences.ts implementation of `exitRunsForContact` had its
// `.eq("contact_id", …)` filter deleted on purpose; see task-4-report.md for
// the observed (correctly failing) result and the revert.
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: keyof Store) => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      const gteFilters: Array<[string, any]> = []
      const ltFilters: Array<[string, any]> = []
      const notNullFields: string[] = []
      let orderCol: string | null = null
      let orderAscending = true
      let limitN: number | null = null
      let mode: "select" | "insert" | "update" = "select"
      let payload: Row | null = null

      const inFilters: Array<[string, any[]]> = []

      const passesFilters = (row: Row) =>
        filters.every(([col, val]) => row[col] === val) &&
        gteFilters.every(([col, val]) => row[col] >= val) &&
        ltFilters.every(([col, val]) => row[col] < val) &&
        inFilters.every(([col, vals]) => vals.includes(row[col]))

      const matched = (): Row[] => {
        let result = rows
          .filter(passesFilters)
          .filter((row) => notNullFields.every((f) => row[f] !== null && row[f] !== undefined))
        if (orderCol) {
          const col = orderCol
          // NULL ORDERING MATCHES POSTGRES, and getting this wrong is not
          // cosmetic: Postgres sorts NULLS LAST ascending and therefore NULLS
          // FIRST descending. A comparator that treats null as "smaller" puts
          // it last on a descending sort — the opposite — so a test for
          // "`order(x, desc)` picks the wrong row when x is null" would pass
          // here while the real query failed. That is exactly the shape of the
          // G09 lastEmail bug.
          result = [...result].sort((a, b) => {
            const an = a[col] === null || a[col] === undefined
            const bn = b[col] === null || b[col] === undefined
            if (an && bn) return a._seq - b._seq
            if (an) return 1 // nulls last ascending
            if (bn) return -1
            if (a[col] === b[col]) return a._seq - b._seq
            return a[col] > b[col] ? 1 : -1
          })
          if (!orderAscending) result.reverse() // ...and therefore nulls FIRST descending
        }
        if (limitN != null) result = result.slice(0, limitN)
        return result
      }

      const doInsert = (): { data: any; error: any } => {
        const p = payload as Row
        if (table === "sequence_messages") {
          const dup = rows.find((r) => r.run_id === p.run_id && r.step_id === p.step_id)
          if (dup) {
            const err: any = new Error('duplicate key value violates unique constraint "sequence_messages_idem"')
            err.code = "23505"
            return { data: null, error: err }
          }
        }
        const row: Row = {
          ...p,
          id: p.id ?? nextId(String(table)),
          created_at: p.created_at ?? new Date().toISOString(),
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
        if (forceErrorOnTable === table) {
          return { data: null, error: new Error(`simulated read failure on ${table}`) }
        }
        if (mode === "insert") return doInsert()
        if (mode === "update") return doUpdate()
        return { data: matched(), error: null }
      }

      const api: any = {
        select: (columns?: string) => {
          selectCalls.push({ table: String(table), columns: columns ?? "" })
          return api
        },
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
        /** Only the `.not(col, "is", null)` shape the DAL actually uses. */
        not: (col: string, op: string, value: any) => {
          if (op === "is" && value === null) notNullFields.push(col)
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
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args })
      return rpcResult
    },
  }),
}))

import {
  claimDueRuns,
  loadSteps,
  loadRunContext,
  applyResendEmailEvent,
  recordSend,
  markSent,
  markFailed,
  advanceRun,
  deferRun,
  TRANSIENT_ERROR_DEFER_REASON,
  exitRun,
  completeRun,
  failRun,
  exitRunsForContact,
} from "@/lib/db/sequences"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { decideStep } from "@/lib/automation/sequence-tick"
import type { SequenceRunRow, SequenceStepRow } from "@/lib/automation/sequence-tick"

beforeEach(() => {
  store.business_settings = []
  store.contacts = []
  store.sequences = []
  store.sequence_runs = []
  store.sequence_messages = []
  store.sequence_steps = []
  store.contact_consents = []
  store.contact_suppressions = []
  seqCounter = 0
  forceErrorOnTable = null
  rpcCalls = []
  rpcResult = { data: [], error: null }
  selectCalls = []
})

function seedBusinessSettings(overrides: Partial<Row> = {}) {
  store.business_settings.push({
    business_id: SINGLETON_BUSINESS_ID,
    display_name: "Test Business",
    sender_name: "Test Sender",
    sender_email: "sender@example.com",
    reply_to: "reply@example.com",
    logo_url: null,
    timezone: "America/New_York",
    quiet_hours_start: 8,
    quiet_hours_end: 21,
    daily_message_cap: 1,
    postal_address: "123 Main St",
    sms_help_text: "Reply STOP to opt out.",
    sms_messaging_service_sid: "",
    sms_sender_phone: "",
    ...overrides,
  })
}

function seedContact(id: string, overrides: Partial<Row> = {}) {
  store.contacts.push({
    id,
    business_id: SINGLETON_BUSINESS_ID,
    email: "lead@example.com",
    phone_e164: null,
    user_id: null,
    timezone: null,
    name: null,
    ...overrides,
  })
}

function seedSequence(id: string, overrides: Partial<Row> = {}) {
  store.sequences.push({
    id,
    business_id: SINGLETON_BUSINESS_ID,
    key: "seq-key",
    name: "Seq",
    trigger_source: "funnel_form",
    ...overrides,
  })
}

function seedRun(id: string, contactId: string, sequenceId: string, overrides: Partial<Row> = {}): Row {
  const run = {
    id,
    business_id: SINGLETON_BUSINESS_ID,
    sequence_id: sequenceId,
    contact_id: contactId,
    current_position: 0,
    status: "active",
    next_run_at: new Date().toISOString(),
    claimed_at: null,
    claimed_by: null,
    attempts: 0,
    exit_reason: null,
    defer_reason: null,
    last_error: null,
    enrolled_at: new Date().toISOString(),
    completed_at: null,
    // G10, migration 00266. NOT NULL DEFAULT '{}' in the database, so a row
    // read back always carries an object — the fixture default matches.
    enrolment_metadata: {},
    ...overrides,
  }
  store.sequence_runs.push(run)
  return run
}

describe("recordSend — the idempotency gate", () => {
  const baseArgs = {
    runId: "run-1",
    stepId: "step-1",
    contactId: "c-1",
    channel: "email" as const,
    toIdentifier: "lead@example.com",
    subject: "Hi",
    bodyRendered: "Body",
    businessId: SINGLETON_BUSINESS_ID,
  }

  it("claims the send when no message row exists yet", async () => {
    const result = await recordSend(baseArgs)
    expect(result.claimed).toBe(true)
    expect(result.messageId).not.toBeNull()
    expect(store.sequence_messages).toHaveLength(1)
    expect(store.sequence_messages[0].status).toBe("queued")
    expect(store.sequence_messages[0].run_id).toBe("run-1")
    expect(store.sequence_messages[0].step_id).toBe("step-1")
  })

  it("refuses a second claim for the same (run_id, step_id)", async () => {
    const first = await recordSend(baseArgs)
    expect(first.claimed).toBe(true)

    const second = await recordSend(baseArgs)
    expect(second).toEqual({ claimed: false, messageId: null })
    // Still exactly one row — the second call did not insert a duplicate.
    expect(store.sequence_messages).toHaveLength(1)
  })

  it("re-claims a queued row older than 15 minutes with no provider id", async () => {
    const first = await recordSend(baseArgs)
    // Simulate a crash: back-date the row past the 15-minute window, leave
    // it queued with no provider_message_id.
    const row = store.sequence_messages.find((m) => m.id === first.messageId)!
    row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString()

    const retry = await recordSend(baseArgs)
    expect(retry).toEqual({ claimed: true, messageId: first.messageId })
    expect(store.sequence_messages).toHaveLength(1)
  })

  it("does NOT re-claim a queued row younger than 15 minutes", async () => {
    const first = await recordSend(baseArgs)
    const row = store.sequence_messages.find((m) => m.id === first.messageId)!
    row.created_at = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const retry = await recordSend(baseArgs)
    expect(retry).toEqual({ claimed: false, messageId: null })
  })

  it("does NOT re-claim a row that already sent", async () => {
    const first = await recordSend(baseArgs)
    const row = store.sequence_messages.find((m) => m.id === first.messageId)!
    row.status = "sent"
    row.provider_message_id = "provider-123"
    row.created_at = new Date(Date.now() - 20 * 60 * 1000).toISOString()

    const retry = await recordSend(baseArgs)
    expect(retry).toEqual({ claimed: false, messageId: null })
  })

  it("rethrows a non-23505 error instead of treating it as a duplicate", async () => {
    forceErrorOnTable = "sequence_messages"
    await expect(recordSend(baseArgs)).rejects.toThrow(/simulated read failure/)
    // The forced error fires on the insert itself (mode === "insert" still
    // routes through `execute()`), so nothing was written.
    expect(store.sequence_messages).toHaveLength(0)
  })
})

describe("exitRunsForContact", () => {
  it("exits only the ACTIVE runs of the given contact", async () => {
    seedRun("run-c1-a", "c-1", "seq-1", { status: "active" })
    seedRun("run-c1-b", "c-1", "seq-2", { status: "active" })
    seedRun("run-c1-done", "c-1", "seq-3", { status: "completed" })
    seedRun("run-c2-active", "c-2", "seq-1", { status: "active" })

    const count = await exitRunsForContact("c-1", "unsubscribed", SINGLETON_BUSINESS_ID)

    expect(count).toBe(2)
    const byId = (id: string) => store.sequence_runs.find((r) => r.id === id)!
    expect(byId("run-c1-a").status).toBe("exited")
    expect(byId("run-c1-a").exit_reason).toBe("unsubscribed")
    expect(byId("run-c1-b").status).toBe("exited")
    // Already-completed run for the same contact must be untouched.
    expect(byId("run-c1-done").status).toBe("completed")
    expect(byId("run-c1-done").exit_reason).toBeNull()
    // Another contact's active run must be untouched — this is the
    // assertion a non-filtering mock would let pass while the code exited
    // everyone.
    expect(byId("run-c2-active").status).toBe("active")
  })

  it("returns the number of runs exited", async () => {
    seedRun("run-1", "c-1", "seq-1", { status: "active" })
    seedRun("run-2", "c-1", "seq-2", { status: "active" })
    seedRun("run-3", "c-1", "seq-3", { status: "active" })

    expect(await exitRunsForContact("c-1", "unsubscribed", SINGLETON_BUSINESS_ID)).toBe(3)
    // Idempotent: calling again finds nothing left active.
    expect(await exitRunsForContact("c-1", "unsubscribed", SINGLETON_BUSINESS_ID)).toBe(0)
  })
})

describe("claimDueRuns", () => {
  it("calls the claim_sequence_runs RPC rather than reading then writing", async () => {
    const fakeRun = { id: "run-1", sequence_id: "seq-1", contact_id: "c-1", current_position: 0, enrolled_at: "x" }
    rpcResult = { data: [fakeRun], error: null }

    const result = await claimDueRuns(25, "tick-token-1", SINGLETON_BUSINESS_ID)

    expect(result).toEqual([fakeRun])
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe("claim_sequence_runs")
    expect(rpcCalls[0].args).toEqual({
      p_business_id: SINGLETON_BUSINESS_ID,
      p_limit: 25,
      p_claim_token: "tick-token-1",
    })
  })

  it("throws on RPC error rather than returning an empty batch", async () => {
    rpcResult = { data: null, error: new Error("connection reset") }
    await expect(claimDueRuns(10, "tick-token-2", SINGLETON_BUSINESS_ID)).rejects.toThrow("connection reset")
  })

  // WHICH tenant, not just that one was passed. Every other call in this file
  // hands SINGLETON_BUSINESS_ID to fixtures seeded under
  // SINGLETON_BUSINESS_ID, so a DAL that ignored its argument and hard-coded
  // the constant would satisfy all of them: they pin the ARITY of the tenant
  // parameter, not the value it carries. The claim RPC is the whole batch's
  // tenant boundary — the wrong id here would run one coach's sequences on
  // another coach's tick.
  it("hands the RPC the business it was given, not the platform's", async () => {
    const otherBusinessId = "22222222-2222-4222-8222-222222222222"
    rpcResult = { data: [], error: null }

    await claimDueRuns(25, "tick-token-3", otherBusinessId)

    // Presence control: an empty rpcCalls array would satisfy any assertion
    // written as "no call carries the platform id".
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args.p_business_id).toBe(otherBusinessId)
  })
})

describe("loadSteps", () => {
  it("returns a sequence's steps in position order", async () => {
    store.sequence_steps.push(
      { id: "s2", sequence_id: "seq-1", position: 1, kind: "wait", wait_minutes: 60 },
      { id: "s1", sequence_id: "seq-1", position: 0, kind: "email", subject: "Hi", body: "B" },
      { id: "other", sequence_id: "seq-other", position: 0, kind: "email", subject: "X", body: "Y" },
    )

    const steps = await loadSteps("seq-1")

    expect(steps.map((s) => s.id)).toEqual(["s1", "s2"])
  })
})

describe("loadRunContext", () => {
  const now = new Date("2026-08-18T18:00:00Z") // 14:00 America/New_York

  it("assembles a DecisionContext from business settings, contact, consent, suppression and siblings", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", phone_e164: null, user_id: "u-1" })
    seedSequence("seq-1", { trigger_source: "funnel_form" })
    const run = seedRun("run-1", "c-1", "seq-1", { enrolled_at: "2026-08-18T10:00:00Z" }) as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.timezone).toBe("America/New_York")
    expect(ctx.quiet).toEqual({ startHour: 8, endHour: 21 })
    expect(ctx.dailyCap).toBe(1)
    expect(ctx.contact).toEqual({ email: "lead@example.com", phone_e164: null, user_id: "u-1", name: null })
    expect(ctx.hasEmailConsent).toBe(false)
    expect(ctx.hasSmsConsent).toBe(false)
    expect(ctx.isSuppressed).toBe(false)
    expect(ctx.enrolledSource).toBe("funnel_form")
    expect(ctx.sentAtToday).toEqual([])
    expect(ctx.activeSiblings).toEqual([])
    expect(ctx.enrolmentMetadata).toEqual({})
  })

  // G10. The claimed run row already carries the column
  // (`claim_sequence_runs` is `RETURNS SETOF public.sequence_runs ...
  // RETURNING r.*`, verified against the database), so this is a mapping,
  // not a query — but it is the mapping the whole predicate depends on, and
  // nothing else pins it.
  it("carries the run's enrolment_metadata into DecisionContext", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1", {
      enrolment_metadata: { service: "camp", role: "parent" },
    }) as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.enrolmentMetadata).toEqual({ service: "camp", role: "parent" })
  })

  it("reads a run from before migration 00266 as {}, not as a crash or a null", async () => {
    // The one-deploy window: the Vercel build is live, the migration is not,
    // and `RETURNING r.*` simply has no such key. `undefined !== null`, so a
    // null check would let `undefined` straight through into
    // `ctx.enrolmentMetadata[key]` and throw on the first branch evaluated.
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    delete (run as unknown as Record<string, unknown>).enrolment_metadata

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.enrolmentMetadata).toEqual({})
  })

  it("carries the run's anchor_at into DecisionContext (G11)", async () => {
    // Same no-query mapping as enrolment_metadata above, and the same reason
    // it needs pinning: every anchored wait's arithmetic depends on it, and
    // nothing else would notice this line being dropped — an un-anchored run
    // COMPLETES rather than erroring, so losing the mapping would silently
    // end every countdown instead of failing loudly.
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1", {
      anchor_at: "2026-07-01T09:00:00.000Z",
    }) as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.anchorAt).toBe("2026-07-01T09:00:00.000Z")
  })

  it("reads a run from before migration 00267 as null, not as undefined", async () => {
    // The one-deploy window again. `undefined` would take neither the "no
    // anchor" branch (which tests `=== null`) nor produce a usable date — it
    // would build an Invalid Date and fail the run, turning a tolerated
    // window into visibly broken sequences.
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    delete (run as unknown as Record<string, unknown>).anchor_at

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.anchorAt).toBeNull()
  })

  // Fix round (Important 1): DecisionContext.contact.name was never
  // selected, so the runner had no name to thread into {{name}} and every
  // sequence email rendered it empty.
  it("carries the contact's name through into DecisionContext.contact.name", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", name: "Jane Doe" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.contact.name).toBe("Jane Doe")
  })

  // G04's reading half. Writing contacts.user_id is worth nothing if the
  // tick never asks for the column: `evaluateBranch` resolves has_user as
  // `user_id !== null`, so a projection that omits it hands over `undefined`,
  // `?? null` turns that into null, and every has_user branch in the four
  // quiz sequences silently takes the "not a client yet" arm again — the
  // exact production symptom G04 exists to end, with the column now full.
  // The store returns whole rows, so this asserts the PROJECTION; the
  // mapping itself is pinned by the "assembles a DecisionContext" case above.
  it("asks for user_id in the contact projection, so has_user can ever be true", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", user_id: "u-1" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    const contactSelects = selectCalls.filter((s) => s.table === "contacts")
    expect(contactSelects).toHaveLength(1)
    expect(contactSelects[0].columns).toContain("user_id")
    expect(ctx.contact.user_id).toBe("u-1")
  })

  // G09's reading half. The predicate is worth nothing if the context never
  // carries the engagement, and the store here is projection-blind, so this
  // asserts the VALUE threads through and that the lookup is scoped to the run.
  it("carries the last email's engagement into DecisionContext.lastEmail", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.sequence_messages.push({
      id: "m-1",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-1",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      opened_at: "2026-08-18T13:30:00Z",
      clicked_at: null,
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.lastEmail).toEqual({ openedAt: "2026-08-18T13:30:00Z", clickedAt: null })
  })

  it("ignores a NEVER-SENT row, even though it sorts first on a descending sent_at", async () => {
    // THE BUG THIS QUERY SHIPPED WITH. `markFailed` writes status `failed`
    // without a `sent_at`, and Postgres orders `sent_at DESC` NULLS FIRST — so
    // a run holding one pre-send failure read that row as "the last email" and
    // both engagement predicates went false forever. On production 73 of the
    // 77 email rows are exactly this shape.
    //
    // This test only means something because the store above orders nulls the
    // way Postgres does; it used to put them last on a descending sort, which
    // would have made this pass with or without the fix.
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.sequence_messages.push({
      id: "m-never-sent",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-0",
      channel: "email",
      status: "failed",
      sent_at: null,
      opened_at: null,
      clicked_at: null,
    })
    store.sequence_messages.push({
      id: "m-real",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-1",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      opened_at: "2026-08-18T13:30:00Z",
      clicked_at: null,
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.lastEmail).toEqual({ openedAt: "2026-08-18T13:30:00Z", clickedAt: null })
  })

  it("takes the LATEST sent email of several, not the first", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.sequence_messages.push({
      id: "m-old",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-1",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-10T13:00:00Z",
      opened_at: "2026-08-10T14:00:00Z",
      clicked_at: null,
    })
    store.sequence_messages.push({
      id: "m-new",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-2",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      opened_at: null,
      clicked_at: null,
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    // The newest email is unopened — "did they open the LAST email" is false,
    // even though an earlier one in the same run was opened.
    expect(ctx.lastEmail).toEqual({ openedAt: null, clickedAt: null })
  })

  it("does not take an SMS row as the last EMAIL", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", phone_e164: "+15551234567" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.sequence_messages.push({
      id: "m-email",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-1",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-10T13:00:00Z",
      opened_at: "2026-08-10T14:00:00Z",
      clicked_at: null,
    })
    store.sequence_messages.push({
      id: "m-sms",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "s-2",
      channel: "sms",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      opened_at: null,
      clicked_at: null,
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    // The SMS is newer. Without the channel filter it would become "the last
    // email" and report never-opened.
    expect(ctx.lastEmail).toEqual({ openedAt: "2026-08-10T14:00:00Z", clickedAt: null })
  })

  it("reports lastEmail as null when this run has sent no email", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.lastEmail).toBeNull()
  })

  it("does not take another RUN's email as this run's last email", async () => {
    // "Did they open the last email" means the last one from THIS sequence.
    // Scoping to the contact would let a newsletter open satisfy a branch in
    // an unrelated sequence.
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.sequence_messages.push({
      id: "m-other",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-ELSEWHERE",
      step_id: "s-1",
      channel: "email",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      opened_at: "2026-08-18T13:30:00Z",
      clicked_at: null,
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.lastEmail).toBeNull()
  })

  it("a contact with no name on file yields contact.name: null, not undefined", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", name: null })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.contact.name).toBeNull()
  })

  it("reports suppression from contact_suppressions keyed by the contact's email", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    store.contact_suppressions.push({
      id: "sup-1",
      business_id: SINGLETON_BUSINESS_ID,
      identifier: "lead@example.com",
      reason: "unsubscribed",
    })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)
    expect(ctx.isSuppressed).toBe(true)
  })

  it("excludes this run itself from activeSiblings but includes other active runs of the same contact", async () => {
    seedBusinessSettings()
    seedContact("c-1")
    seedSequence("seq-1")
    seedSequence("seq-2")
    const run = seedRun("run-1", "c-1", "seq-1", { enrolled_at: "2026-08-18T10:00:00Z" }) as SequenceRunRow
    seedRun("run-2", "c-1", "seq-2", { status: "active", enrolled_at: "2026-08-18T09:00:00Z" })
    seedRun("run-3", "c-1", "seq-2", { status: "completed", enrolled_at: "2026-08-18T08:00:00Z" })

    const ctx = await loadRunContext(run, now, SINGLETON_BUSINESS_ID)

    expect(ctx.activeSiblings.map((s) => s.id)).toEqual(["run-2"])
  })

  // G35. The consent read is scoped to the run's business, like every other
  // read in loadRunContext. Every other fixture in this file is filed under
  // the platform id, so only a run in a business that is NOT the platform's
  // can tell "passed the tenant" from "ignored it" or "hard-coded it".
  // MUTANT: loadRunContext calls hasConsent without `businessId`.
  it("reads consent under the run's business, not another business's (G35)", async () => {
    const RUN_BUSINESS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const OTHER_BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    seedBusinessSettings({ business_id: RUN_BUSINESS })
    seedContact("c-1", { business_id: RUN_BUSINESS, email: "lead@example.com" })
    seedSequence("seq-1", { business_id: RUN_BUSINESS })
    const run = seedRun("run-1", "c-1", "seq-1", { business_id: RUN_BUSINESS }) as SequenceRunRow
    // Another business's GRANTS for the same contact id, on both channels.
    store.contact_consents.push(
      {
        id: "k-other-email",
        business_id: OTHER_BUSINESS,
        contact_id: "c-1",
        channel: "email",
        granted: true,
        occurred_at: "2026-08-18T00:00:00Z",
        created_at: "2026-08-18T00:00:00Z",
      },
      {
        id: "k-other-sms",
        business_id: OTHER_BUSINESS,
        contact_id: "c-1",
        channel: "sms",
        granted: true,
        occurred_at: "2026-08-18T00:00:00Z",
        created_at: "2026-08-18T00:00:00Z",
      },
    )

    const ctx = await loadRunContext(run, now, RUN_BUSINESS)
    expect(ctx.hasEmailConsent).toBe(false)
    expect(ctx.hasSmsConsent).toBe(false)

    // Presence control: the same grant, filed under the run's own business,
    // counts — and only on its own channel.
    store.contact_consents.push({
      id: "k-own-sms",
      business_id: RUN_BUSINESS,
      contact_id: "c-1",
      channel: "sms",
      granted: true,
      occurred_at: "2026-08-18T00:00:00Z",
      created_at: "2026-08-18T00:00:00Z",
    })
    const withOwn = await loadRunContext(run, now, RUN_BUSINESS)
    expect(withOwn.hasSmsConsent).toBe(true)
    expect(withOwn.hasEmailConsent).toBe(false)
  })

  it("does NOT swallow a hasConsent read failure", async () => {
    seedBusinessSettings()
    seedContact("c-1")
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    forceErrorOnTable = "contact_consents"

    await expect(loadRunContext(run, now, SINGLETON_BUSINESS_ID)).rejects.toThrow()
  })

  it("does NOT swallow an isSuppressed read failure", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    forceErrorOnTable = "contact_suppressions"

    await expect(loadRunContext(run, now, SINGLETON_BUSINESS_ID)).rejects.toThrow()
  })

  it("throws when the contact row is missing", async () => {
    seedBusinessSettings()
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-missing", "seq-1") as SequenceRunRow

    await expect(loadRunContext(run, now, SINGLETON_BUSINESS_ID)).rejects.toThrow()
  })

  // Fix wave (Important, Finding 1): applyDeliveryStatus (lib/db/sequences.ts)
  // OVERWRITES a message row's status from "sent" to "delivered" (or
  // "undelivered"/"failed") once Twilio's status callback lands — that's the
  // whole point of that function. The daily-cap query used to filter
  // `.eq("status", "sent")`, so the instant a message's Twilio callback
  // arrived it silently stopped counting toward today's cap, and a sibling
  // sequence could message the same contact again the same day. The fix
  // widens the filter to `.in("status", ["sent", "delivered", "undelivered",
  // "failed"])` — every post-send lifecycle state a message can be in.
  // Pre-send failures are excluded for free: they never got a `sent_at`, and
  // the query's `sent_at` bounds already require a value inside today's
  // window.
  it("counts a message whose status was overwritten sent -> delivered toward today's daily cap, deferring a sibling sms send", async () => {
    seedBusinessSettings({ daily_message_cap: 1 })
    seedContact("c-1", { email: "lead@example.com", phone_e164: "+15551234567" })
    seedSequence("seq-1", { trigger_source: "funnel_form" })
    seedSequence("seq-2", { trigger_source: "funnel_form" })
    // The message that already went out today, on a DIFFERENT sequence run —
    // its status was overwritten from "sent" to "delivered" by
    // applyDeliveryStatus once Twilio's callback landed, exactly the
    // lifecycle transition this test guards.
    store.sequence_messages.push({
      id: "msg-delivered",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "step-1",
      channel: "sms",
      status: "delivered",
      sent_at: "2026-08-18T13:00:00Z",
      delivered_at: "2026-08-18T13:01:00Z",
    })
    store.contact_consents.push({
      id: "consent-1",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      channel: "sms",
      granted: true,
      occurred_at: "2026-08-18T00:00:00Z",
      created_at: "2026-08-18T00:00:00Z",
    })
    // The sibling run this test is actually deciding for — a different
    // sequence, same contact, due to send its own sms step right now.
    const sibling = seedRun("run-2", "c-1", "seq-2", {
      enrolled_at: "2026-08-18T10:00:00Z",
      current_position: 0,
    }) as SequenceRunRow

    const ctx = await loadRunContext(sibling, now, SINGLETON_BUSINESS_ID)

    // The bug this guards against: filtering on status === "sent" only would
    // miss this row entirely, leaving sentAtToday empty and the cap
    // unenforced.
    expect(ctx.sentAtToday).toHaveLength(1)

    const smsStep: SequenceStepRow = {
      id: "step-sibling-sms",
      position: 0,
      kind: "sms",
      wait_minutes: null,
      subject: null,
      body: "Hi {{name}}",
      branch_condition: null,
      on_true_position: null,
      on_false_position: null,
      config: {},
    }
    const action = decideStep(sibling, [smsStep], ctx)

    expect(action).toMatchObject({ kind: "defer", reason: "daily_cap" })
  })
})

describe("write-back functions", () => {
  it("advanceRun sets the position, next_run_at and clears the claim", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", {
      current_position: 0,
      claimed_at: new Date().toISOString(),
      claimed_by: "tick-1",
      last_error: "some prior crash",
    })
    const deferUntil = new Date("2026-08-19T00:00:00Z")

    await advanceRun("run-1", 3, deferUntil)

    expect(run.current_position).toBe(3)
    expect(run.next_run_at).toBe(deferUntil.toISOString())
    expect(run.last_error).toBeNull()
    expect(run.claimed_at).toBeNull()
    expect(run.claimed_by).toBeNull()
  })

  it("advanceRun clears defer_reason on forward progress", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", { defer_reason: "quiet_hours" })

    await advanceRun("run-1", 1)

    expect(run.defer_reason).toBeNull()
  })

  it("advanceRun without deferUntil sets next_run_at to now (immediately due)", async () => {
    const run = seedRun("run-1", "c-1", "seq-1")
    const before = Date.now()

    await advanceRun("run-1", 1)

    expect(new Date(run.next_run_at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it("deferRun sets next_run_at, records the reason in defer_reason, clears the claim, and leaves last_error null", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", {
      claimed_at: new Date().toISOString(),
      claimed_by: "tick-1",
    })
    const until = new Date("2026-08-19T08:00:00Z")

    await deferRun("run-1", until, "quiet_hours")

    expect(run.next_run_at).toBe(until.toISOString())
    expect(run.defer_reason).toBe("quiet_hours")
    // This is the whole point of the fix: a deferred run (the engine's
    // normal steady state — sitting out quiet hours or the daily cap) must
    // never look like a crash to anything reading `last_error`.
    expect(run.last_error).toBeNull()
    expect(run.claimed_at).toBeNull()
    expect(run.claimed_by).toBeNull()
    expect(run.status).toBe("active")
  })

  // Fix wave (Important 7). `claim_sequence_runs` increments `attempts` on
  // every claim. If nothing reset it, a healthy long-lived run would exhaust
  // the runner's transient-error retry budget simply by existing — the first
  // real blip after a fortnight of nightly quiet-hours defers would kill it
  // permanently. Resetting on anything that is not a transient-error defer is
  // what makes `attempts` a count of CONSECUTIVE failures, and is exactly what
  // migration 00217's own comment assumes ("attempts climbing without
  // current_position moving is the signature of a poison run").
  it("advanceRun resets attempts — forward progress clears the retry budget", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", { attempts: 4 })

    await advanceRun("run-1", 1)

    expect(run.attempts).toBe(0)
  })

  it("a guardrail defer resets attempts — quiet hours is not a failed attempt", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", { attempts: 4 })

    await deferRun("run-1", new Date("2026-08-19T08:00:00Z"), "quiet_hours")

    expect(run.attempts).toBe(0)
  })

  it("a transient-error defer LEAVES attempts alone, so a poison run still runs out of retries", async () => {
    const run = seedRun("run-1", "c-1", "seq-1", { attempts: 4 })

    await deferRun("run-1", new Date("2026-08-19T08:00:00Z"), TRANSIENT_ERROR_DEFER_REASON)

    expect(run.attempts).toBe(4)
    expect(run.defer_reason).toBe("transient_error")
    expect(run.status).toBe("active")
  })

  it("exitRun marks the run exited with the reason and completed_at", async () => {
    const run = seedRun("run-1", "c-1", "seq-1")

    await exitRun("run-1", "suppressed")

    expect(run.status).toBe("exited")
    expect(run.exit_reason).toBe("suppressed")
    expect(run.completed_at).not.toBeNull()
  })

  it("completeRun marks the run completed", async () => {
    const run = seedRun("run-1", "c-1", "seq-1")

    await completeRun("run-1")

    expect(run.status).toBe("completed")
    expect(run.completed_at).not.toBeNull()
  })

  it("failRun marks the run failed and records the error", async () => {
    const run = seedRun("run-1", "c-1", "seq-1")

    await failRun("run-1", "unknown branch condition: phase_of_moon")

    expect(run.status).toBe("failed")
    expect(run.last_error).toBe("unknown branch condition: phase_of_moon")
  })

  it("markSent marks a message sent with provider details", async () => {
    store.sequence_messages.push({ id: "msg-1", status: "queued", provider: null, provider_message_id: null })

    await markSent("msg-1", "resend", "resend-abc")

    const msg = store.sequence_messages[0]
    expect(msg.status).toBe("sent")
    expect(msg.provider).toBe("resend")
    expect(msg.provider_message_id).toBe("resend-abc")
    expect(msg.sent_at).not.toBeUndefined()
  })

  it("markFailed marks a message failed with the error", async () => {
    store.sequence_messages.push({ id: "msg-1", status: "queued" })

    await markFailed("msg-1", "resend rejected the address")

    const msg = store.sequence_messages[0]
    expect(msg.status).toBe("failed")
    expect(msg.error).toBe("resend rejected the address")
  })
})

// ---------------------------------------------------------------------------
// G09: Resend's engagement events. The columns (delivered_at / opened_at /
// clicked_at, migration 00216) have existed since the engine shipped and had
// NO writer — so "branch on whether they opened the last email", which the
// quotation sells, could never be true.
// ---------------------------------------------------------------------------
describe("applyResendEmailEvent", () => {
  function seedMessage(over: Row = {}) {
    store.sequence_messages.push({
      id: "msg-1",
      business_id: SINGLETON_BUSINESS_ID,
      contact_id: "c-1",
      run_id: "run-1",
      step_id: "step-1",
      channel: "email",
      provider: "resend",
      provider_message_id: "re_abc123",
      status: "sent",
      sent_at: "2026-08-18T13:00:00Z",
      delivered_at: null,
      opened_at: null,
      clicked_at: null,
      ...over,
    })
  }

  const AT = new Date("2026-08-18T14:00:00Z")

  it("records a delivery against the message Resend names", async () => {
    seedMessage()
    const outcome = await applyResendEmailEvent("re_abc123", "delivered", AT)
    expect(outcome).toBe("updated")
    const row = store.sequence_messages.find((m) => m.id === "msg-1")!
    expect(row.delivered_at).toBe(AT.toISOString())
    expect(row.status).toBe("delivered")
  })

  it("records an open and a click", async () => {
    seedMessage()
    await applyResendEmailEvent("re_abc123", "opened", AT)
    await applyResendEmailEvent("re_abc123", "clicked", AT)
    const row = store.sequence_messages.find((m) => m.id === "msg-1")!
    expect(row.opened_at).toBe(AT.toISOString())
    expect(row.clicked_at).toBe(AT.toISOString())
  })

  it("keeps the FIRST open, not the latest — these arrive repeatedly and out of order", async () => {
    // Apple Mail Privacy Protection re-fetches the pixel, and a mail client
    // re-opened weeks later fires again. The first open is the one that
    // answers "did this message land"; a later one must not move it.
    seedMessage({ opened_at: "2026-08-18T13:30:00Z" })
    const outcome = await applyResendEmailEvent("re_abc123", "opened", AT)
    expect(outcome).toBe("ignored")
    expect(store.sequence_messages.find((m) => m.id === "msg-1")!.opened_at).toBe("2026-08-18T13:30:00Z")
  })

  it("does not let a stale delivery event un-deliver a message", async () => {
    seedMessage({ status: "delivered", delivered_at: "2026-08-18T13:10:00Z" })
    const outcome = await applyResendEmailEvent("re_abc123", "delivered", AT)
    expect(outcome).toBe("ignored")
    expect(store.sequence_messages.find((m) => m.id === "msg-1")!.delivered_at).toBe("2026-08-18T13:10:00Z")
  })

  it("a retried delivery records the timestamp but does NOT un-fail a bounced row", async () => {
    // Svix retries. A `delivered` redelivered AFTER a `bounced` (or after
    // markFailed) would otherwise flip the row back to delivered and un-say
    // the bounce — the status would then disagree with the suppression that
    // the bounce created.
    seedMessage({ status: "failed", delivered_at: null })

    const outcome = await applyResendEmailEvent("re_abc123", "delivered", AT)

    expect(outcome).toBe("updated")
    const row = store.sequence_messages.find((m) => m.id === "msg-1")!
    expect(row.delivered_at).toBe(AT.toISOString())
    expect(row.status).toBe("failed")
  })

  it("marks a bounce failed", async () => {
    seedMessage()
    const outcome = await applyResendEmailEvent("re_abc123", "bounced", AT)
    expect(outcome).toBe("updated")
    expect(store.sequence_messages.find((m) => m.id === "msg-1")!.status).toBe("failed")
  })

  it("reports an unknown message rather than writing nothing silently", async () => {
    // Resend sends events for EVERY email the account sends, including all the
    // transactional mail that has no sequence_messages row at all. That is the
    // common case, not an error — but the route must tell it apart from a
    // write that failed.
    const outcome = await applyResendEmailEvent("re_not_ours", "opened", AT)
    expect(outcome).toBe("unknown_message")
  })

  it("matches only a resend row — a twilio id that collides cannot be marked opened", async () => {
    seedMessage({ id: "msg-sms", provider: "twilio", channel: "sms", provider_message_id: "re_abc123" })
    const outcome = await applyResendEmailEvent("re_abc123", "opened", AT)
    expect(outcome).toBe("unknown_message")
    expect(store.sequence_messages.find((m) => m.id === "msg-sms")!.opened_at).toBeNull()
  })
})
