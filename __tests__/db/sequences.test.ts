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
    await expect(claimDueRuns(10, "tick-token-2")).rejects.toThrow("connection reset")
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

    const ctx = await loadRunContext(run, now)

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
  })

  // Fix round (Important 1): DecisionContext.contact.name was never
  // selected, so the runner had no name to thread into {{name}} and every
  // sequence email rendered it empty.
  it("carries the contact's name through into DecisionContext.contact.name", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", name: "Jane Doe" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now)

    expect(ctx.contact.name).toBe("Jane Doe")
  })

  it("a contact with no name on file yields contact.name: null, not undefined", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com", name: null })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow

    const ctx = await loadRunContext(run, now)

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

    const ctx = await loadRunContext(run, now)
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

    const ctx = await loadRunContext(run, now)

    expect(ctx.activeSiblings.map((s) => s.id)).toEqual(["run-2"])
  })

  it("does NOT swallow a hasConsent read failure", async () => {
    seedBusinessSettings()
    seedContact("c-1")
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    forceErrorOnTable = "contact_consents"

    await expect(loadRunContext(run, now)).rejects.toThrow()
  })

  it("does NOT swallow an isSuppressed read failure", async () => {
    seedBusinessSettings()
    seedContact("c-1", { email: "lead@example.com" })
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-1", "seq-1") as SequenceRunRow
    forceErrorOnTable = "contact_suppressions"

    await expect(loadRunContext(run, now)).rejects.toThrow()
  })

  it("throws when the contact row is missing", async () => {
    seedBusinessSettings()
    seedSequence("seq-1")
    const run = seedRun("run-1", "c-missing", "seq-1") as SequenceRunRow

    await expect(loadRunContext(run, now)).rejects.toThrow()
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

    const ctx = await loadRunContext(sibling, now)

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
