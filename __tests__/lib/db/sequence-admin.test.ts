// __tests__/lib/db/sequence-admin.test.ts
//
// lib/db/sequence-admin.ts — loading a sequence for editing, flipping its
// switch, and writing back a step list. Mocked at `@/lib/supabase`, so every
// select string and every `.eq()` value is asserted LITERALLY: a mocked DAL
// suite cannot otherwise tell a real column name from a made-up one, or a real
// tenant id from a hardcoded one — this subsystem has already shipped
// `contacts(full_name, email)` against a table whose real column is `name`
// with every test green.
//
// `saveSequenceSteps` gets its own emphasis: Ruling 1 overrides the task
// brief's "passes the plan through unchanged" — the TypeScript and RPC shapes
// genuinely differ (`runId`→`run_id`, `{runId,to}[]`→`{run_id,to_position}[]`
// objects, `{runId,from}[]`→plain `uuid[]`), so the exact object reaching
// `.rpc()` is asserted rather than merely "was called".

import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = {
  table: string
  op: "select" | "update"
  arg: string | Record<string, unknown>
  ops: [string, ...unknown[]][]
}
const calls: Call[] = []

/** Queued results, one per `.from(...).select/update(...)` call, in call order. */
let results: { data: unknown; error: unknown }[] = []

function makeBuilder(table: string, op: "select" | "update", arg: string | Record<string, unknown>) {
  const record: Call = { table, op, arg, ops: [] }
  calls.push(record)
  const index = calls.length - 1
  const settle = () => results[index] ?? { data: op === "select" ? [] : null, error: null }

  const builder: Record<string, unknown> = {}
  for (const method of ["eq", "order", "limit", "in", "not", "range"]) {
    builder[method] = (...args: unknown[]) => {
      record.ops.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(settle())
  builder.maybeSingle = () => settle()
  builder.single = () => settle()
  return builder
}

let rpcCalls: { name: string; args: unknown }[] = []
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (select: string) => makeBuilder(table, "select", select),
      update: (payload: Record<string, unknown>) => makeBuilder(table, "update", payload),
    }),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return rpcResult
    },
  }),
}))

import { loadSequenceForEdit, saveSequenceSteps, setSequenceStatus } from "@/lib/db/sequence-admin"
import type { StepDraft, StepSavePlan } from "@/lib/lead-engine/step-list"

const BUSINESS = "11111111-1111-4111-8111-111111111111"
const OTHER_BUSINESS = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  calls.length = 0
  results = []
  rpcCalls = []
  rpcResult = { data: null, error: null }
})

const STEP_SELECT =
  "id, position, kind, wait_minutes, subject, body, branch_condition, on_true_position, on_false_position, config"

describe("loadSequenceForEdit", () => {
  function queueHappyPath() {
    results = [
      { data: { id: "seq-1", key: "cold_lead", name: "Cold Lead", status: "active" }, error: null },
      {
        data: [
          {
            id: "step-1",
            position: 0,
            kind: "email",
            wait_minutes: null,
            subject: "Hi",
            body: "Body",
            branch_condition: null,
            on_true_position: null,
            on_false_position: null,
            config: {},
          },
          {
            id: "step-2",
            position: 1,
            kind: "wait",
            wait_minutes: 60,
            subject: null,
            body: null,
            branch_condition: null,
            on_true_position: null,
            on_false_position: null,
            config: {},
          },
        ],
        error: null,
      },
      { data: [{ step_id: "step-1" }, { step_id: "step-1" }, { step_id: "step-1" }], error: null },
      { data: [{ id: "run-1", current_position: 0 }], error: null },
    ]
  }

  it("reads the sequence, its steps and its select strings exactly", async () => {
    queueHappyPath()
    await loadSequenceForEdit(BUSINESS, "cold_lead")

    expect(calls[0].table).toBe("sequences")
    expect(calls[0].arg).toBe("id, key, name, status")

    expect(calls[1].table).toBe("sequence_steps")
    expect(calls[1].arg).toBe(STEP_SELECT)

    expect(calls[2].table).toBe("sequence_messages")
    expect(calls[2].arg).toBe("step_id")

    expect(calls[3].table).toBe("sequence_runs")
    expect(calls[3].arg).toBe("id, current_position")
  })

  it("carries the tenant predicate on every one of the four reads", async () => {
    queueHappyPath()
    await loadSequenceForEdit(BUSINESS, "cold_lead")
    for (const call of calls) {
      expect(call.ops, `${call.table} is missing the business_id predicate`).toContainEqual([
        "eq",
        "business_id",
        BUSINESS,
      ])
    }
  })

  it("does NOT let a wrong-tenant value slip through — mutating the VALUE, not the arity", async () => {
    // The trap this repo has already shipped: an argument-blind mock tolerates
    // `.eq("business_id", <some other value>)` just as well as the right one.
    // This asserts the literal value, so a hardcoded or swapped id fails it.
    queueHappyPath()
    await loadSequenceForEdit(BUSINESS, "cold_lead")
    expect(calls[0].ops).not.toContainEqual(["eq", "business_id", OTHER_BUSINESS])
  })

  it("returns null for another tenant's key, without reading steps/messages/runs at all", async () => {
    results = [{ data: null, error: null }]
    const result = await loadSequenceForEdit(BUSINESS, "someone-elses-key")
    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("assembles drafts (full editable shape) and steps (id+position only) from the same rows", async () => {
    queueHappyPath()
    const result = await loadSequenceForEdit(BUSINESS, "cold_lead")
    expect(result?.steps).toEqual([
      { id: "step-1", position: 0 },
      { id: "step-2", position: 1 },
    ])
    expect(result?.drafts).toEqual([
      {
        id: "step-1",
        kind: "email",
        wait_minutes: null,
        subject: "Hi",
        body: "Body",
        branch_condition: null,
        on_true_position: null,
        on_false_position: null,
        config: {},
      },
      {
        id: "step-2",
        kind: "wait",
        wait_minutes: 60,
        subject: null,
        body: null,
        branch_condition: null,
        on_true_position: null,
        on_false_position: null,
        config: {},
      },
    ])
  })

  it("tallies sentCountByStepId by hand, grouped by step_id", async () => {
    queueHappyPath()
    const result = await loadSequenceForEdit(BUSINESS, "cold_lead")
    expect(result?.sentCountByStepId).toEqual({ "step-1": 3 })
    // step-2 never sent anything, so it is simply absent — not present at 0.
    expect(result?.sentCountByStepId["step-2"]).toBeUndefined()
  })

  it("skips the sequence_messages read entirely when the sequence has no steps", async () => {
    results = [
      { data: { id: "seq-1", key: "empty", name: "Empty", status: "draft" }, error: null },
      { data: [], error: null },
      { data: [], error: null }, // sequence_runs
    ]
    const result = await loadSequenceForEdit(BUSINESS, "empty")
    expect(result?.sentCountByStepId).toEqual({})
    expect(calls.map((c) => c.table)).toEqual(["sequences", "sequence_steps", "sequence_runs"])
  })

  it("reads activeRuns filtered to status = active — dropping this predicate would pull dead runs into the plan", async () => {
    queueHappyPath()
    await loadSequenceForEdit(BUSINESS, "cold_lead")
    expect(calls[3].ops).toContainEqual(["eq", "status", "active"])
  })

  it("returns activeRuns as RunPointer rows", async () => {
    queueHappyPath()
    const result = await loadSequenceForEdit(BUSINESS, "cold_lead")
    expect(result?.activeRuns).toEqual([{ id: "run-1", current_position: 0 }])
  })

  it("throws rather than swallowing a failed sequence read", async () => {
    results = [{ data: null, error: { message: "boom" } }]
    await expect(loadSequenceForEdit(BUSINESS, "cold_lead")).rejects.toBeTruthy()
  })
})

describe("setSequenceStatus", () => {
  it("writes status and updated_at, scoped by id and business_id, and returns the PRIOR status", async () => {
    results = [
      { data: { id: "seq-1", status: "draft" }, error: null },
      { data: null, error: null },
    ]
    const result = await setSequenceStatus(BUSINESS, "cold_lead", "active")
    expect(result).toEqual({ id: "seq-1", from: "draft" })

    expect(calls[0].table).toBe("sequences")
    expect(calls[0].op).toBe("select")
    expect(calls[0].arg).toBe("id, status")
    expect(calls[0].ops).toContainEqual(["eq", "business_id", BUSINESS])

    expect(calls[1].table).toBe("sequences")
    expect(calls[1].op).toBe("update")
    expect(calls[1].arg).toMatchObject({ status: "active" })
    expect(calls[1].ops).toContainEqual(["eq", "id", "seq-1"])
    expect(calls[1].ops).toContainEqual(["eq", "business_id", BUSINESS])
  })

  it("returns null for another tenant's key, and never issues the update", async () => {
    results = [{ data: null, error: null }]
    const result = await setSequenceStatus(BUSINESS, "someone-elses-key", "paused")
    expect(result).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls.some((c) => c.op === "update")).toBe(false)
  })

  it("throws rather than swallowing a failed read", async () => {
    results = [{ data: null, error: { message: "read boom" } }]
    await expect(setSequenceStatus(BUSINESS, "cold_lead", "active")).rejects.toBeTruthy()
  })

  it("throws rather than swallowing a failed write", async () => {
    results = [
      { data: { id: "seq-1", status: "draft" }, error: null },
      { data: null, error: { message: "write boom" } },
    ]
    await expect(setSequenceStatus(BUSINESS, "cold_lead", "active")).rejects.toBeTruthy()
  })
})

describe("saveSequenceSteps — Ruling 1: translate the plan, don't pass it through", () => {
  const STEPS: StepDraft[] = [
    {
      id: "step-1",
      kind: "email",
      wait_minutes: null,
      subject: "Hi",
      body: "Body",
      branch_condition: null,
      on_true_position: null,
      on_false_position: null,
      config: {},
    },
  ]

  it("calls .rpc() exactly once, with the EXACT mapped object — run_id/to_position, plain uuid[] for exits", async () => {
    const plan: StepSavePlan = {
      repoint: [{ runId: "run-1", from: 2, to: 3 }],
      exit: [{ runId: "run-2", from: 5 }],
      unchanged: ["run-3"],
    }

    await saveSequenceSteps(BUSINESS, "seq-1", STEPS, plan)

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({
      name: "save_sequence_steps",
      args: {
        p_business_id: BUSINESS,
        p_sequence_id: "seq-1",
        p_steps: STEPS,
        p_repoint: [{ run_id: "run-1", to_position: 3 }],
        p_exit_run_ids: ["run-2"],
      },
    })
  })

  it("maps multiple repoints and exits, and drops `unchanged` entirely — SQL has no use for it", async () => {
    const plan: StepSavePlan = {
      repoint: [
        { runId: "run-a", from: 0, to: 1 },
        { runId: "run-b", from: 1, to: 2 },
      ],
      exit: [
        { runId: "run-c", from: 3 },
        { runId: "run-d", from: 4 },
      ],
      unchanged: ["run-e", "run-f"],
    }
    await saveSequenceSteps(BUSINESS, "seq-1", STEPS, plan)
    expect(rpcCalls[0].args).toMatchObject({
      p_repoint: [
        { run_id: "run-a", to_position: 1 },
        { run_id: "run-b", to_position: 2 },
      ],
      p_exit_run_ids: ["run-c", "run-d"],
    })
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain("run-e")
  })

  it("passes an empty plan as empty arrays, not omitted fields", async () => {
    const plan: StepSavePlan = { repoint: [], exit: [], unchanged: [] }
    await saveSequenceSteps(BUSINESS, "seq-1", STEPS, plan)
    expect(rpcCalls[0].args).toMatchObject({ p_repoint: [], p_exit_run_ids: [] })
  })

  it("surfaces the RPC's own error — this is the guard a route-level bypass cannot get past", async () => {
    // Simulates the plpgsql RAISE in migration 00256's save_sequence_steps
    // when the §4.6 refusal fires. The DAL must not swallow this into a
    // silent success.
    rpcResult = { data: null, error: { message: "refusing to remove a step that has already sent 3 message(s)" } }
    await expect(
      saveSequenceSteps(BUSINESS, "seq-1", STEPS, { repoint: [], exit: [], unchanged: [] }),
    ).rejects.toMatchObject({ message: expect.stringContaining("already sent 3 message") })
  })
})
