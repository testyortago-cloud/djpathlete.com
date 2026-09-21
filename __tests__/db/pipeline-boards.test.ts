// @vitest-environment node
//
// G29 (Task 3). Board CRUD and `savePipelineStages` — lib/db/pipeline.ts.
//
// Own fake, not a reuse of __tests__/db/pipeline.test.ts's harness: same
// style (a real in-memory store, filters actually narrow rows, `.update()`
// patches and filters are recorded for assertion), but PROJECTION-AWARE
// everywhere rather than for one table — a `.select("a, b")` call gets back
// rows carrying ONLY `a` and `b`, so a reader asking for the wrong column
// gets `undefined` instead of a full row that happens to carry the right
// value anyway. That gap has hidden three real bugs in this repo.
import { describe, expect, it, vi, beforeEach } from "vitest"

type Row = Record<string, any>

type Store = {
  pipelines: Row[]
  pipeline_stages: Row[]
  opportunities: Row[]
}

const store: Store = { pipelines: [], pipeline_stages: [], opportunities: [] }

let seqCounter = 0
function nextId(prefix: string) {
  seqCounter += 1
  return `${prefix}-${seqCounter}`
}

type PgError = { code: string; message: string; details: string | null; hint: string | null }

function uniqueViolation(constraint: string): PgError {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint "${constraint}"`,
    details: null,
    hint: null,
  }
}

/** Every `.rpc()` call the mocked client actually executed, in order. */
const rpcCalls: Array<{ fn: string; args: Row }> = []

/**
 * Every query (select / insert / update / delete) the mocked client actually
 * executed: table, mode, the `.select()` projection if one was asked for,
 * and the `.eq()` filters applied.
 *
 * This is what "argument-blind mocks tolerate predicates" (this repo's own
 * lesson) is for: with globally-unique fixture ids, dropping a
 * `.eq("business_id", …)` filter often does not change what a query
 * RETURNS, because the id alone already picks the one matching row. Only a
 * log of the filters actually sent can prove the predicate was there.
 */
const queryLog: Array<{
  table: string
  mode: "select" | "insert" | "update" | "delete"
  projection: string[] | "*"
  filters: Array<[string, any]>
}> = []

function filtersFor(table: string, mode: "select" | "insert" | "update" | "delete") {
  return queryLog.filter((q) => q.table === table && q.mode === mode).flatMap((q) => q.filters)
}

/**
 * Every row actually inserted, in order — so a test can recover the id the
 * fake assigned (`nextId`) without hard-coding its counter scheme.
 */
const insertedRowsLog: Array<{ table: string; row: Row }> = []

/**
 * One-shot errors a test can queue up for a specific (table, mode) pair,
 * consumed FIFO on the first matching query. Used to simulate the
 * stage-insert failure and the compensating-delete failure fix round 1's
 * tests need — this fake has no real Postgres underneath it to fail on its
 * own.
 */
const injectedErrors: Array<{ table: string; mode: string; error: PgError }> = []
function takeInjectedError(table: string, mode: string): PgError | null {
  const idx = injectedErrors.findIndex((e) => e.table === table && e.mode === mode)
  if (idx === -1) return null
  return injectedErrors.splice(idx, 1)[0].error
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: keyof Store) => {
      const rows = store[table]
      const filters: Array<[string, any]> = []
      let projection: string[] | null = null
      const orderBys: Array<[string, boolean]> = []
      let mode: "select" | "insert" | "update" | "delete" = "select"
      let payload: Row | Row[] | null = null

      const passesFilters = (row: Row) => filters.every(([col, val]) => row[col] === val)

      const project = (row: Row): Row => {
        if (!projection) return row
        const out: Row = {}
        for (const col of projection) out[col] = row[col]
        return out
      }

      const log = () => {
        queryLog.push({ table: String(table), mode, projection: projection ? [...projection] : "*", filters: [...filters] })
      }

      const matched = (): Row[] => {
        let result = rows.filter(passesFilters)
        if (orderBys.length > 0) {
          const lastAscending = orderBys[orderBys.length - 1][1]
          result = [...result].sort((a, b) => {
            for (const [col, ascending] of orderBys) {
              if (a[col] === b[col]) continue
              return (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1)
            }
            return (a._seq - b._seq) * (lastAscending ? 1 : -1)
          })
        }
        log()
        return result.map(project)
      }

      // The one real constraint this suite needs: `pipelines_key_per_business`
      // (migration 00219). `createPipelineBoard`'s "refuses a clashing name"
      // test depends on this firing exactly like Postgres would.
      const constraintViolation = (): PgError | null => {
        if (table !== "pipelines") return null
        const p = (Array.isArray(payload) ? payload[0] : payload) as Row
        if (rows.some((r) => r.business_id === p.business_id && r.key === p.key)) {
          return uniqueViolation("pipelines_key_per_business")
        }
        return null
      }

      const doInsert = (): { data: any; error: any } => {
        const violation = constraintViolation()
        if (violation) return { data: null, error: violation }
        const items = Array.isArray(payload) ? payload : [payload as Row]
        const inserted: Row[] = items.map((p) => {
          const row: Row = {
            ...p,
            id: p.id ?? nextId(String(table)),
            created_at: p.created_at ?? new Date().toISOString(),
            updated_at: p.updated_at ?? new Date().toISOString(),
            _seq: rows.length,
          }
          rows.push(row)
          insertedRowsLog.push({ table: String(table), row })
          return row
        })
        log()
        return { data: inserted.map(project), error: null }
      }

      const doUpdate = (): { data: any; error: any } => {
        const targets = rows.filter(passesFilters)
        for (const row of targets) Object.assign(row, payload)
        log()
        return { data: targets.map(project), error: null }
      }

      const doDelete = (): { data: any; error: any } => {
        const targets = rows.filter(passesFilters)
        const survivors = rows.filter((r) => !passesFilters(r))
        rows.length = 0
        rows.push(...survivors)
        log()
        return { data: targets.map(project), error: null }
      }

      const execute = (): { data: any; error: any } => {
        const injected = takeInjectedError(String(table), mode)
        if (injected) return { data: null, error: injected }
        if (mode === "insert") return doInsert()
        if (mode === "update") return doUpdate()
        if (mode === "delete") return doDelete()
        return { data: matched(), error: null }
      }

      const api: any = {
        select: (columns?: string) => {
          projection = columns && columns !== "*" ? columns.split(",").map((c) => c.trim()).filter(Boolean) : null
          return api
        },
        insert: (p: Row | Row[]) => {
          mode = "insert"
          payload = p
          return api
        },
        update: (p: Row) => {
          mode = "update"
          payload = p
          return api
        },
        delete: () => {
          mode = "delete"
          return api
        },
        eq: (col: string, val: any) => {
          filters.push([col, val])
          return api
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderBys.push([col, opts?.ascending ?? true])
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
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args })
      return { data: null, error: null }
    },
  }),
}))

import {
  createPipelineBoard,
  updatePipelineBoard,
  readStagesForEdit,
  savePipelineStages,
  DEFAULT_PIPELINE_KEY,
} from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

// Matches __tests__/db/pipeline.test.ts's own convention: a second tenant id
// that pins the ARGUMENT's value is being used, not merely its arity.
const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  store.pipelines = []
  store.pipeline_stages = []
  store.opportunities = []
  seqCounter = 0
  rpcCalls.length = 0
  queryLog.length = 0
  insertedRowsLog.length = 0
  injectedErrors.length = 0
})

function seedDefaultBoard(businessId: string = SINGLETON_BUSINESS_ID) {
  store.pipelines.push({
    id: "pipe-default",
    business_id: businessId,
    key: DEFAULT_PIPELINE_KEY,
    name: "Coaching",
    status: "active",
  })
  return "pipe-default"
}

function seedOtherBoard(businessId: string = SINGLETON_BUSINESS_ID) {
  store.pipelines.push({
    id: "pipe-camps",
    business_id: businessId,
    key: "camps_clinics",
    name: "Camps & Clinics",
    status: "active",
  })
  store.pipeline_stages.push(
    {
      id: "stage-open",
      business_id: businessId,
      pipeline_id: "pipe-camps",
      key: "consult_booked",
      name: "Consult Booked",
      position: 1,
      kind: "open",
      amber_after_days: 3,
      red_after_days: 7,
    },
    {
      id: "stage-won",
      business_id: businessId,
      pipeline_id: "pipe-camps",
      key: "won",
      name: "Won",
      position: 2,
      kind: "won",
      amber_after_days: null,
      red_after_days: null,
    },
    {
      id: "stage-lost",
      business_id: businessId,
      pipeline_id: "pipe-camps",
      key: "lost",
      name: "Lost",
      position: 3,
      kind: "lost",
      amber_after_days: null,
      red_after_days: null,
    },
  )
  return "pipe-camps"
}

describe("createPipelineBoard", () => {
  it("slugifies the name into a key", async () => {
    const result = await createPipelineBoard({ name: "Camps & Clinics", businessId: SINGLETON_BUSINESS_ID })
    expect(result.key).toBe("camps_clinics")
  })

  it("refuses a name that slugifies to a key this tenant already has", async () => {
    seedOtherBoard(SINGLETON_BUSINESS_ID) // seeds key "camps_clinics"

    await expect(
      createPipelineBoard({ name: "Camps & Clinics", businessId: SINGLETON_BUSINESS_ID }),
    ).rejects.toThrow(/camps_clinics/)

    // No new pipelines row and no stages seeded — the refusal happened
    // before anything else was written.
    expect(store.pipelines).toHaveLength(1)
    expect(store.pipeline_stages).toHaveLength(3)
  })

  it("does not refuse the same key for a DIFFERENT tenant", async () => {
    seedOtherBoard(OTHER_BUSINESS_ID) // "camps_clinics" exists, but for someone else

    const result = await createPipelineBoard({ name: "Camps & Clinics", businessId: SINGLETON_BUSINESS_ID })
    expect(result.key).toBe("camps_clinics")
    expect(store.pipelines.filter((p) => p.key === "camps_clinics")).toHaveLength(2)
  })

  it("seeds the new board with a won and a lost stage, so it is valid the moment it exists", async () => {
    const result = await createPipelineBoard({ name: "Referrals", businessId: SINGLETON_BUSINESS_ID })

    const stages = store.pipeline_stages.filter((s) => s.pipeline_id === result.id)
    expect(stages).toHaveLength(2)

    const won = stages.find((s) => s.kind === "won")
    const lost = stages.find((s) => s.kind === "lost")
    expect(won).toBeTruthy()
    expect(lost).toBeTruthy()
    expect(won!.position).toBe(1)
    expect(lost!.position).toBe(2)
    expect(won!.business_id).toBe(SINGLETON_BUSINESS_ID)
    expect(lost!.business_id).toBe(SINGLETON_BUSINESS_ID)
  })

  // Fix round 1, Finding 1 / controller ruling R9.
  it("compensates with a delete when the stage insert fails, and throws a readable error", async () => {
    injectedErrors.push({
      table: "pipeline_stages",
      mode: "insert",
      error: { code: "55000", message: "simulated network timeout", details: null, hint: null },
    })

    await expect(
      createPipelineBoard({ name: "Referrals", businessId: SINGLETON_BUSINESS_ID }),
    ).rejects.toThrow(/simulated network timeout/)

    // The orphaned board was cleaned up, not left behind.
    expect(store.pipelines).toHaveLength(0)
    expect(store.pipeline_stages).toHaveLength(0)

    const createdId = insertedRowsLog.find((r) => r.table === "pipelines")!.row.id
    const deleteFilters = filtersFor("pipelines", "delete")
    expect(deleteFilters).toContainEqual(["id", createdId])
    expect(deleteFilters).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })

  it("names the orphaned board id when the compensating delete also fails", async () => {
    injectedErrors.push(
      {
        table: "pipeline_stages",
        mode: "insert",
        error: { code: "55000", message: "simulated network timeout", details: null, hint: null },
      },
      {
        table: "pipelines",
        mode: "delete",
        error: { code: "55000", message: "simulated delete failure", details: null, hint: null },
      },
    )

    let caught: Error | null = null
    try {
      await createPipelineBoard({ name: "Referrals", businessId: SINGLETON_BUSINESS_ID })
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(Error)

    const createdId = insertedRowsLog.find((r) => r.table === "pipelines")!.row.id
    expect(caught!.message).toContain(createdId)
    expect(caught!.message).toContain("simulated network timeout")
    expect(caught!.message).toContain("simulated delete failure")

    // Genuinely orphaned this time: the cleanup itself failed, so the row
    // (with zero stages) is still sitting in the store.
    expect(store.pipelines).toHaveLength(1)
    expect(store.pipeline_stages).toHaveLength(0)
  })

  // Fix round 1, Finding 2.
  it("refuses a name that slugifies to an empty key", async () => {
    await expect(createPipelineBoard({ name: "!!!", businessId: SINGLETON_BUSINESS_ID })).rejects.toThrow(
      /at least one letter or number/,
    )
    expect(store.pipelines).toHaveLength(0)
  })
})

describe("updatePipelineBoard", () => {
  it("refuses to archive the board DEFAULT_PIPELINE_KEY names", async () => {
    const id = seedDefaultBoard(SINGLETON_BUSINESS_ID)

    await expect(
      updatePipelineBoard({ pipelineId: id, businessId: SINGLETON_BUSINESS_ID, status: "archived" }),
    ).rejects.toThrow(/cannot be archived/)

    expect(store.pipelines.find((p) => p.id === id)!.status).toBe("active")
  })

  it("archives any other board", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    await updatePipelineBoard({ pipelineId: id, businessId: SINGLETON_BUSINESS_ID, status: "archived" })

    expect(store.pipelines.find((p) => p.id === id)!.status).toBe("archived")
  })

  it("scopes the update by business_id", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    // Wrong tenant, no archive flag — so this exercises the plain UPDATE's
    // own scope, not the read-before-archive guard.
    await updatePipelineBoard({ pipelineId: id, businessId: OTHER_BUSINESS_ID, name: "Hijacked" })

    expect(store.pipelines.find((p) => p.id === id)!.name).toBe("Camps & Clinics")

    const updateFilters = filtersFor("pipelines", "update")
    expect(updateFilters).toContainEqual(["business_id", OTHER_BUSINESS_ID])
  })

  it("does not leak another tenant's board name through the archive-refusal message", async () => {
    const id = seedDefaultBoard(OTHER_BUSINESS_ID) // someone else's default board

    // Wrong tenant AND archiving — proves readBoardRow itself is scoped,
    // not just the final UPDATE.
    await expect(
      updatePipelineBoard({ pipelineId: id, businessId: SINGLETON_BUSINESS_ID, status: "archived" }),
    ).rejects.toThrow(/was not found/)

    const readFilters = filtersFor("pipelines", "select")
    expect(readFilters).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })
})

describe("readStagesForEdit", () => {
  it("returns the full SavedStage shape and scopes both reads by business_id", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
    })

    const result = await readStagesForEdit(id, SINGLETON_BUSINESS_ID)

    expect(result.stages).toHaveLength(3)
    const open = result.stages.find((s) => s.key === "consult_booked")!
    expect(open).toEqual({
      id: "stage-open",
      key: "consult_booked",
      position: 1,
      name: "Consult Booked",
      kind: "open",
      amberAfterDays: 3,
      redAfterDays: 7,
    })
    expect(result.cardCountByStageId.get("stage-open")).toBe(1)
    expect(result.cardCountByStageId.get("stage-won")).toBeUndefined()

    const stageFilters = filtersFor("pipeline_stages", "select")
    expect(stageFilters).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
    const oppFilters = filtersFor("opportunities", "select")
    expect(oppFilters).toContainEqual(["business_id", SINGLETON_BUSINESS_ID])
  })

  it("does not see another tenant's stages or cards", async () => {
    const id = seedOtherBoard(OTHER_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: OTHER_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
    })

    const result = await readStagesForEdit(id, SINGLETON_BUSINESS_ID)

    expect(result.stages).toHaveLength(0)
    expect(result.cardCountByStageId.size).toBe(0)
  })
})

describe("savePipelineStages", () => {
  it("returns the validator's problems without calling the RPC when the list is invalid", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [],
      destinations: {},
    })

    expect(result).toEqual({
      ok: false,
      problems: [{ index: null, message: "A board needs at least one stage." }],
    })
    expect(rpcCalls).toHaveLength(0)
    // Never even read the board's current stages — the pure check ran first.
    expect(filtersFor("pipeline_stages", "select")).toHaveLength(0)
  })

  it("refuses a removal that would strand cards, naming the stage", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
    })

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      // Drops "stage-open" (consult_booked) entirely, no destination given.
      stages: [
        { id: "stage-won", key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0].message).toContain("consult_booked")
    expect(result.problems[0].message).toContain("1 card")
    expect(rpcCalls).toHaveLength(0)
  })

  it("calls save_pipeline_stages with the ordered, snake_case array when the list is valid", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      // Reordered: open stage now last, plus a brand-new stage (id: null) first.
      stages: [
        { id: null, key: "new_lead", name: "New Lead", kind: "open", amberAfterDays: 1, redAfterDays: 2 },
        { id: "stage-won", key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
        {
          id: "stage-open",
          key: "consult_booked",
          name: "Consult Booked",
          kind: "open",
          amberAfterDays: 3,
          redAfterDays: 7,
        },
      ],
      destinations: {},
    })

    expect(result).toEqual({ ok: true })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe("save_pipeline_stages")
    const args = rpcCalls[0].args
    expect(args.p_business_id).toBe(SINGLETON_BUSINESS_ID)
    expect(args.p_pipeline_id).toBe(id)
    expect(args.p_move_cards).toEqual([])

    // Submitted order IS the position — no `position` field, array order
    // preserved exactly as given.
    expect(args.p_stages).toHaveLength(4)
    expect(args.p_stages.map((s: Row) => s.key)).toEqual(["new_lead", "won", "lost", "consult_booked"])
    for (const stage of args.p_stages) {
      expect(stage.position).toBeUndefined()
      expect(stage.amberAfterDays).toBeUndefined()
      expect(stage.redAfterDays).toBeUndefined()
    }
    expect(args.p_stages[3]).toEqual({
      id: "stage-open",
      key: "consult_booked",
      name: "Consult Booked",
      kind: "open",
      amber_after_days: 3,
      red_after_days: 7,
    })
  })

  it("sends a removal's move-card destination in snake_case (from_stage_id/to_stage_id)", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
    })

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [
        { id: "stage-won", key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: { "stage-open": "stage-lost" },
    })

    expect(result).toEqual({ ok: true })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args.p_move_cards).toEqual([{ from_stage_id: "stage-open", to_stage_id: "stage-lost" }])
  })
})
