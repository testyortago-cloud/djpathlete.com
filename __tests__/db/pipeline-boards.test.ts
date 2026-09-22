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
  PipelineBoardNotFoundError,
} from "@/lib/db/pipeline"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
// The real validator, not a restatement of it — see the seeded-board test
// below for why the seed is checked against the thing that would refuse it.
import { validateStageList } from "@/lib/lead-engine/stage-list"

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

  // Whole-branch review, Important 3 (controller ruling R19). The seed used
  // to be TWO stages — Won at position 1, Lost at 2 — while
  // `createOpportunityManually` files every hand-made card onto the
  // POSITION-1 stage whatever its kind. So the first person a coach added to
  // a brand-new board landed in "Won", with `outcome` null: a deal nobody
  // won, in the column that means the deal is done. The dialog even said so
  // out loud (`Their card starts in "Won".`).
  it("seeds the new board with an OPEN stage at position 1, then won and lost", async () => {
    const result = await createPipelineBoard({ name: "Referrals", businessId: SINGLETON_BUSINESS_ID })

    const stages = store.pipeline_stages.filter((s) => s.pipeline_id === result.id)
    expect(stages).toHaveLength(3)

    const first = stages.find((s) => s.position === 1)!
    const won = stages.find((s) => s.kind === "won")
    const lost = stages.find((s) => s.kind === "lost")

    // THE POINT OF THIS TEST: position 1 is where a hand-made card lands, so
    // it must be a stage a card can legitimately start in.
    expect(first.kind).toBe("open")
    expect(first.key).toBe("new")

    expect(won).toBeTruthy()
    expect(lost).toBeTruthy()
    expect(won!.position).toBe(2)
    expect(lost!.position).toBe(3)
    expect(won!.business_id).toBe(SINGLETON_BUSINESS_ID)
    expect(lost!.business_id).toBe(SINGLETON_BUSINESS_ID)
    expect(first.business_id).toBe(SINGLETON_BUSINESS_ID)
  })

  // The seed is only worth anything if the board it produces is one the rest
  // of the system accepts. `validateStageList` is the same pure function the
  // route and the DAL refuse a save with, so running the seeded list through
  // it is the real question — "exactly one won, exactly one lost, and a
  // name and key on every row" — rather than three hand-written assertions
  // that could all agree with each other and still describe a broken board.
  it("produces a board validateStageList accepts, positions in order and no duplicate keys", async () => {
    const result = await createPipelineBoard({ name: "Referrals", businessId: SINGLETON_BUSINESS_ID })
    const stages = store.pipeline_stages
      .filter((s) => s.pipeline_id === result.id)
      .sort((a, b) => a.position - b.position)

    expect(stages.map((s) => s.position)).toEqual([1, 2, 3])
    expect(new Set(stages.map((s) => s.key)).size).toBe(3)
    expect(
      validateStageList(
        stages.map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          kind: s.kind,
          amberAfterDays: s.amber_after_days ?? null,
          redAfterDays: s.red_after_days ?? null,
        })),
      ),
    ).toEqual([])
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

  it("scopes the update by business_id — a foreign tenant's write throws, not a silent no-op", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    // Wrong tenant, no archive flag — so this exercises the plain UPDATE's
    // own scope, not the read-before-archive guard.
    //
    // Fix round 1, Finding 1 (controller ruling R10): this used to resolve
    // silently — PostgREST reports no error on an UPDATE that matches zero
    // rows — so a foreign-tenant rename looked identical to a successful
    // one to the caller. It must now throw.
    await expect(
      updatePipelineBoard({ pipelineId: id, businessId: OTHER_BUSINESS_ID, name: "Hijacked" }),
    ).rejects.toThrow(PipelineBoardNotFoundError)

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

  it("renames a board that exists and belongs to this tenant — the presence control for the two tests below", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    await updatePipelineBoard({ pipelineId: id, businessId: SINGLETON_BUSINESS_ID, name: "Renamed" })

    expect(store.pipelines.find((p) => p.id === id)!.name).toBe("Renamed")
  })

  it("throws PipelineBoardNotFoundError for a plain rename of an id that does not exist at all", async () => {
    // No `status`, so this never reaches the archive pre-check — it is the
    // bare UPDATE path Finding 1 found unguarded.
    await expect(
      updatePipelineBoard({ pipelineId: "does-not-exist", businessId: SINGLETON_BUSINESS_ID, name: "X" }),
    ).rejects.toThrow(PipelineBoardNotFoundError)
  })

  it("answers a nonexistent id and a foreign tenant's id with the exact same error class and message template", async () => {
    // The whole point of R10: a caller must not be able to tell "no such
    // board" apart from "not your board" by inspecting what was thrown —
    // that distinction is exactly what would let an attacker enumerate
    // other tenants' board ids. Both paths funnel through the SAME
    // `if (!data) throw new PipelineBoardNotFoundError(...)`, so this pins
    // both the class and the message template, not just "it threw".
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)

    await expect(
      updatePipelineBoard({ pipelineId: "does-not-exist", businessId: SINGLETON_BUSINESS_ID, name: "X" }),
    ).rejects.toMatchObject({
      name: "PipelineBoardNotFoundError",
      message: "Board does-not-exist was not found for this business.",
    })

    await expect(
      updatePipelineBoard({ pipelineId: id, businessId: OTHER_BUSINESS_ID, name: "X" }),
    ).rejects.toMatchObject({
      name: "PipelineBoardNotFoundError",
      message: `Board ${id} was not found for this business.`,
    })
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
    expect(result.closedCardCountByStageId.size).toBe(0)
  })

  // Whole-branch review, Important 2. The closed count is a SECOND number
  // over the same rows, and the two must not be the same number: a stage
  // holding one open card and two won ones counts 3 and 2.
  it("counts closed cards separately from every card, on the same stage", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    const card = (cardId: string, stageId: string, outcome: string | null) => ({
      id: cardId,
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: stageId,
      contact_id: cardId,
      outcome,
    })
    store.opportunities.push(
      card("opp-open", "stage-won", null),
      card("opp-won-1", "stage-won", "won"),
      card("opp-won-2", "stage-won", "won"),
      card("opp-lost", "stage-lost", "lost"),
    )

    const result = await readStagesForEdit(id, SINGLETON_BUSINESS_ID)

    expect(result.cardCountByStageId.get("stage-won")).toBe(3)
    expect(result.closedCardCountByStageId.get("stage-won")).toBe(2)
    expect(result.closedCardCountByStageId.get("stage-lost")).toBe(1)
    // ABSENT, not 0 — the same shape `cardCountByStageId` uses, which the
    // editor's `?? 0` relies on.
    expect(result.closedCardCountByStageId.get("stage-open")).toBeUndefined()
  })

  // The projection matters: this fake returns ONLY the columns a `.select()`
  // asked for, so a reader that forgot `outcome` would see `undefined` on
  // every row and count zero closed cards forever. That is the mutant this
  // pins — not the arithmetic.
  it("asks the database for `outcome`, not just `stage_id`", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-won",
      contact_id: "c1",
      outcome: "won",
    })

    const result = await readStagesForEdit(id, SINGLETON_BUSINESS_ID)
    expect(result.closedCardCountByStageId.get("stage-won")).toBe(1)

    const oppSelect = queryLog.find((q) => q.table === "opportunities" && q.mode === "select")
    expect(oppSelect?.projection).toContain("outcome")
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
    // R16: the message a coach reads names the stage the way THEY named it
    // ("Consult Booked"), never the stored key ("consult_booked"), and says
    // "1 card" rather than "1 card(s)". The fixture's name and key differ by
    // more than case, so neither assertion can pass by coincidence, and the
    // exact string is pinned rather than a `toContain` that "1 cards" would
    // also satisfy.
    expect(result.problems[0].message).toBe(
      'Stage "Consult Booked" still has 1 card on it. Say which stage they should move to before removing it.',
    )
    expect(result.problems[0].message).not.toContain("consult_booked")
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

  // -------------------------------------------------------------------------
  // WHOLE-BRANCH REVIEW, IMPORTANT 1. A destination the same save is removing
  // — or one belonging to another board entirely — used to sail through every
  // layer: `planStageSave` emitted the move, `strandedStageProblems` saw a
  // removal WITH a destination and said nothing, and the SQL relocated the
  // cards onto a stage it then deleted.
  // -------------------------------------------------------------------------

  it("refuses a destination that the same save is also removing, and never calls the RPC", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
      outcome: null,
    })
    // A second open stage, so the list can lose BOTH and still be valid.
    store.pipeline_stages.push({
      id: "stage-proposal",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      key: "proposal",
      name: "Proposal",
      position: 4,
      kind: "open",
      amber_after_days: null,
      red_after_days: null,
    })

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      // Both open stages gone; the cards were pointed at the one that is
      // ALSO going.
      stages: [
        { id: "stage-won", key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: { "stage-open": "stage-proposal" },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems).toEqual([
      {
        index: null,
        message:
          'The stage you chose for the cards on "Consult Booked" ("Proposal") is being removed too. ' +
          "Pick one that is staying.",
      },
    ])
    expect(rpcCalls).toHaveLength(0)
  })

  // THE CRAFTED-REQUEST VARIANT, and the worse one. `destinations` is
  // `z.record(z.string(), z.string())` at the route and
  // `opportunities.stage_id` has no composite FK tying it to `pipeline_id`,
  // so a `to_stage_id` naming ANOTHER BOARD'S stage relocated real cards
  // there with no error at all — after which they rendered on neither board,
  // because `readBoard` joins stages by `pipeline_id`.
  it("refuses a destination that is not a stage on this board at all", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
      outcome: null,
    })

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [
        { id: "stage-won", key: "won", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: { "stage-open": "some-other-boards-stage" },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    // A DIFFERENT sentence, because it is a different mistake — claiming the
    // destination "is being removed too" would be untrue.
    expect(result.problems[0].message).toBe(
      'The stage you chose for the cards on "Consult Booked" is not a stage on this board. Pick one that is staying.',
    )
    expect(rpcCalls).toHaveLength(0)
  })

  // THE PRESENCE CONTROL for both refusals above: the identical save with a
  // destination that SURVIVES goes through. Without it, a function that
  // refused every destination would pass both.
  it("control: the same removal with a surviving destination is accepted", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-open",
      contact_id: "c1",
      outcome: null,
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
  })

  // -------------------------------------------------------------------------
  // WHOLE-BRANCH REVIEW, IMPORTANT 2 (controller ruling R19). `readBoard`
  // shows an `open` column only the cards whose `outcome` is null, so turning
  // a Won stage into an open one takes every settled deal on it off the board
  // — still in the database, still counted in revenue, on no screen.
  // -------------------------------------------------------------------------

  it("refuses turning a won stage open while it still holds closed cards, naming the stage and the count", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push(
      { id: "opp-1", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c1", outcome: "won" },
      { id: "opp-2", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c2", outcome: "won" },
    )

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [
        {
          id: "stage-open",
          key: "consult_booked",
          name: "Consult Booked",
          kind: "open",
          amberAfterDays: 3,
          redAfterDays: 7,
        },
        // The board keeps exactly one won and one lost stage, so
        // `validateStageList` is happy — only the new guard can refuse this.
        { id: "stage-won", key: "won", name: "Won", kind: "open", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: null, key: "lost_2", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems).toEqual([
      {
        index: 1,
        message:
          'Stage "Won" holds 2 cards that are already won or lost. Changing it to a stage that is still open ' +
          "would take them off the board, where nobody would find them. Move those cards to another stage first.",
      },
    ])
    expect(rpcCalls).toHaveLength(0)
  })

  // THE PRESENCE CONTROL. The identical kind change on a Won stage holding
  // only OPEN cards is allowed — nothing disappears, so nothing is refused.
  it("control: the same kind change is allowed when the stage holds no closed cards", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push({
      id: "opp-1",
      business_id: SINGLETON_BUSINESS_ID,
      pipeline_id: id,
      stage_id: "stage-won",
      contact_id: "c1",
      outcome: null,
    })

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [
        {
          id: "stage-open",
          key: "consult_booked",
          name: "Consult Booked",
          kind: "open",
          amberAfterDays: 3,
          redAfterDays: 7,
        },
        { id: "stage-won", key: "won", name: "Won", kind: "open", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: null, key: "lost_2", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: {},
    })

    expect(result).toEqual({ ok: true })
    expect(rpcCalls).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // RE-REVIEW, IMPORTANT RESIDUAL. The same end state as the kind-change case
  // above, reached through the removal DESTINATION instead: finished deals
  // moved off a Won stage that is being removed, onto a stage that is open.
  // -------------------------------------------------------------------------

  it("refuses sending a removed Won stage's finished deals to a stage that stays open", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push(
      { id: "opp-1", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c1", outcome: "won" },
      { id: "opp-2", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c2", outcome: "won" },
    )

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      // A replacement Won row, the old Won stage dropped — so the list is
      // perfectly valid and neither of the other two checks fires.
      stages: [
        { id: "stage-open", key: "consult_booked", name: "Consult Booked", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
        { id: null, key: "won_2", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: { "stage-won": "stage-open" },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems).toEqual([
      {
        index: null,
        message:
          'Stage "Won" holds 2 cards that are already won or lost. Moving them to "Consult Booked", which is ' +
          "still open, would take them off the board, where nobody would find them. Send them to a Won or Lost " +
          "stage instead.",
      },
    ])
    expect(rpcCalls).toHaveLength(0)
  })

  // THE PRESENCE CONTROL: the identical removal, sent to the Lost stage, is
  // accepted — the cards stay on a stage the board shows in full.
  it("control: the same removal is accepted when the destination stays a closed stage", async () => {
    const id = seedOtherBoard(SINGLETON_BUSINESS_ID)
    store.opportunities.push(
      { id: "opp-1", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c1", outcome: "won" },
      { id: "opp-2", business_id: SINGLETON_BUSINESS_ID, pipeline_id: id, stage_id: "stage-won", contact_id: "c2", outcome: "won" },
    )

    const result = await savePipelineStages({
      pipelineId: id,
      businessId: SINGLETON_BUSINESS_ID,
      stages: [
        { id: "stage-open", key: "consult_booked", name: "Consult Booked", kind: "open", amberAfterDays: 3, redAfterDays: 7 },
        { id: null, key: "won_2", name: "Won", kind: "won", amberAfterDays: null, redAfterDays: null },
        { id: "stage-lost", key: "lost", name: "Lost", kind: "lost", amberAfterDays: null, redAfterDays: null },
      ],
      destinations: { "stage-won": "stage-lost" },
    })

    expect(result).toEqual({ ok: true })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].args.p_move_cards).toEqual([{ from_stage_id: "stage-won", to_stage_id: "stage-lost" }])
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
