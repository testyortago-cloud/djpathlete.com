// lib/db/funnel-builder.ts — the draft + turn-log DAL for the AI page builder.
//
// WHAT THESE TESTS ARE ACTUALLY FOR. A DAL test that stubs the client and then
// asserts the stub's own return value came back is this repo's named dominant
// defect class wearing a lab coat: it cannot fail. So the fake client here is a
// RECORDER, not a stub — every `.from()/.update()/.eq()/.order()/.limit()` is
// captured, and the assertions are about the QUERY THAT WAS BUILT, because the
// query is the only thing this module actually decides.
//
// Three of those decisions are load-bearing and each is pinned by a test that
// goes red on a one-line edit:
//
//   1. THE OPTIMISTIC LOCK IS PART OF THE WRITE. Deleting
//      `.eq("doc_revision", expectedRevision)` leaves a DAL that still passes
//      "it updates the step" and "it inserts a turn" and silently lets a
//      second admin tab overwrite the first — a full-snapshot document, so a
//      lost update is a page reverting several turns, not a merge conflict.
//   2. `listTurns` SORTS DESCENDING AND REVERSES. Sorting ascending and
//      limiting returns the OLDEST 200 turns; on a busy page the chat would
//      show the first day's conversation and none of today's.
//   3. `getDraft` DISTINGUISHES "never built" FROM "holds something I cannot
//      read". Collapsing both to `doc: null` is silent data loss: the caller's
//      natural response to the first destroys the owner's page in the second.
//
// THE SELECTED COLUMNS ARE PART OF THE QUERY AND ARE ASSERTED LIKE THE REST.
// The fake answers with its canned reply whatever `.select()` asked for, so a
// missing or narrowed column list is invisible in the RESULT and visible only
// in `rec.columns`. That gap was real and total, not cosmetic: PostgREST
// returns `data: null` for an `.update()` carrying no representation, so
// deleting `.select("doc_revision")` from the compare-and-swap makes EVERY
// successful write report `stale_revision` — a builder that never saves,
// against a suite that stays green. Recording a field and never asserting it
// is the same defect class as a stub asserting its own return value; every
// `columns` value this DAL sets is therefore pinned below.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

interface QueryRecord {
  table: string
  op: "" | "select" | "insert" | "update" | "delete"
  columns?: string
  payload?: Record<string, unknown>
  filters: Array<[string, unknown]>
  order?: { column: string; ascending: boolean }
  limit?: number
  terminator?: "single" | "maybeSingle" | "await"
}

type Reply = { data: unknown; error: { message: string } | null }

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  state: { reply: (() => ({ data: null, error: null })) as (rec: unknown) => Reply },
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const rec = { table, op: "", filters: [] } as unknown as QueryRecord
      h.calls.push(rec)
      const settle = (terminator: QueryRecord["terminator"]) => {
        rec.terminator = terminator
        return Promise.resolve(h.state.reply(rec))
      }
      const api = {
        select(columns?: string) {
          rec.columns = columns
          if (rec.op === "") rec.op = "select"
          return api
        },
        insert(payload: Record<string, unknown>) {
          rec.op = "insert"
          rec.payload = payload
          return api
        },
        update(payload: Record<string, unknown>) {
          rec.op = "update"
          rec.payload = payload
          return api
        },
        delete() {
          rec.op = "delete"
          return api
        },
        eq(column: string, value: unknown) {
          rec.filters.push([column, value])
          return api
        },
        order(column: string, opts: { ascending: boolean }) {
          rec.order = { column, ascending: opts.ascending }
          return api
        },
        limit(n: number) {
          rec.limit = n
          return api
        },
        maybeSingle: () => settle("maybeSingle"),
        single: () => settle("single"),
        then: (
          onFulfilled?: ((value: Reply) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => settle("await").then(onFulfilled, onRejected),
      }
      return api
    },
  }),
}))

import {
  getDraft,
  appendTurn,
  listTurns,
  revertToRevision,
  TURN_HISTORY_LIMIT,
} from "@/lib/db/funnel-builder"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const calls = h.calls as QueryRecord[]

function onQuery(reply: (rec: QueryRecord) => Reply) {
  h.state.reply = reply as (rec: unknown) => Reply
}

function find(table: string, op: QueryRecord["op"]): QueryRecord | undefined {
  return calls.find((c) => c.table === table && c.op === op)
}

const STEP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const PROGRAM = "11111111-1111-4111-8111-111111111111"

function doc(headline = "Train like an athlete"): SectionDoc {
  return {
    v: 1,
    engine: "sections",
    theme: { tone: "light", accent: "accent", radius: "soft" },
    sections: [
      {
        id: "hero1",
        kind: "hero",
        variant: "centered",
        style: {},
        props: { headline, primaryCta: { label: "Start", target: { kind: "program", ref: PROGRAM } } },
      },
    ],
  } as SectionDoc
}

beforeEach(() => {
  calls.length = 0
  onQuery(() => ({ data: null, error: null }))
})

// ---------------------------------------------------------------------------

describe("getDraft", () => {
  it("returns the stored document and its revision", async () => {
    const stored = doc()
    onQuery(() => ({ data: { project_data: stored, doc_revision: 7 }, error: null }))

    const draft = await getDraft(STEP)

    // Revision asserted as 7, not merely "a number": a DAL that returned a
    // hardcoded 0 would satisfy every optimistic-lock caller by handing them a
    // number the row never had, and the CAS would then fail forever.
    expect(draft).toEqual({ doc: stored, docInvalid: false, revision: 7 })
    const q = find("funnel_steps", "select")
    expect(q?.filters).toEqual([["id", STEP]])
    // MUTANT: `.select("project_data")` — drop `doc_revision` from the column
    // list. The assertion above cannot see it, because the fake replies with
    // both fields whatever was asked for; against real PostgREST `doc_revision`
    // would be absent, `revision` would be `undefined ?? 0` FOREVER, and the
    // compare-and-swap this whole file exists to protect would fail on every
    // write from revision 1 onwards. The mirror mutant — `.select("doc_revision")`
    // alone — silently returns a step whose page has vanished, so both columns
    // are pinned.
    expect(q?.columns).toContain("doc_revision")
    expect(q?.columns).toContain("project_data")
  })

  it("reports project_data that is NOT a SectionDoc as docInvalid, never as an absent draft", async () => {
    // MUTANT THIS KILLS: `return {doc: null, docInvalid: false, revision}` for
    // an unparseable blob — one word, and every other test in this file stays
    // green. A step created before 00203 still holds GrapesJS editor state,
    // and a caller that reads "no document yet" will generate a fresh page and
    // write it over the owner's existing one. The flag is the only thing
    // standing between that legacy row and silent data loss.
    const grapesJs = { pages: [{ frames: [] }], styles: [], assets: [] }
    onQuery(() => ({ data: { project_data: grapesJs, doc_revision: 3 }, error: null }))

    const draft = await getDraft(STEP)

    expect(draft).toEqual({ doc: null, docInvalid: true, revision: 3 })
  })

  it("reports a step that has never been built as an ABSENT draft, not an invalid one", async () => {
    // The other side of the same coin — if `docInvalid` were simply "doc is
    // null" the test above would pass for the wrong reason.
    onQuery(() => ({ data: { project_data: null, doc_revision: 0 }, error: null }))

    expect(await getDraft(STEP)).toEqual({ doc: null, docInvalid: false, revision: 0 })
  })

  it("returns null when the STEP itself does not exist", async () => {
    onQuery(() => ({ data: null, error: null }))

    expect(await getDraft(STEP)).toBeNull()
  })

  it("throws on a PostgREST error rather than reporting an empty draft", async () => {
    // An empty draft is indistinguishable from a fresh page, so swallowing the
    // error here is the same data-loss path as the docInvalid case.
    onQuery(() => ({ data: null, error: { message: "boom" } }))

    await expect(getDraft(STEP)).rejects.toThrow(/getDraft/)
  })
})

// ---------------------------------------------------------------------------

describe("appendTurn — the optimistic lock", () => {
  function acceptSwapThenInsert() {
    onQuery((rec) => {
      if (rec.table === "funnel_steps") return { data: [{ doc_revision: 5 }], error: null }
      return { data: { id: "turn-1", revision: 5 }, error: null }
    })
  }

  it("makes the revision check PART OF THE WRITE, not a read-then-write", async () => {
    // THE test of this file. The write must be filtered on BOTH the step id
    // and the revision the caller believed was current, in one statement.
    //
    // MUTANT: delete `.eq("doc_revision", input.expectedRevision)`. The DAL
    // still updates the right row, still bumps the counter, still inserts the
    // turn, still returns `ok: true` — and two admin tabs silently overwrite
    // each other. Nothing else in this file or the suite notices.
    acceptSwapThenInsert()

    await appendTurn({ stepId: STEP, expectedRevision: 4, role: "assistant", doc: doc() })

    const swap = find("funnel_steps", "update")
    expect(swap?.filters).toEqual([
      ["id", STEP],
      ["doc_revision", 4],
    ])
    // ...and the swap is what moves the counter forward.
    expect(swap?.payload?.doc_revision).toBe(5)
    // THE SWAP MUST ASK FOR A REPRESENTATION BACK, and this is the mutant with
    // the worst blast radius in the file. MUTANT: delete `.select("doc_revision")`
    // from the update chain. PostgREST answers an `.update()` with no
    // representation as `data: null`, so `swapped` is null, the zero-rows branch
    // fires on every SUCCESSFUL write, and the builder reports `stale_revision`
    // forever while the draft it just saved sits in the column. The fake returns
    // its canned array regardless, so nothing else here — not the filters, not
    // the payload, not the result shape — can see it.
    expect(swap?.columns).toBe("doc_revision")
    // A read-then-write implementation would have SELECTed the revision first.
    // There is no such read on the happy path.
    expect(find("funnel_steps", "select")).toBeUndefined()
  })

  it("reports a stale revision and writes NO turn row", async () => {
    // Zero rows matched = somebody else moved first. The route turns this into
    // a 409. MUTANT: carrying on to the insert anyway, which produces a turn
    // row claiming a document that is not the draft.
    onQuery((rec) => {
      if (rec.table === "funnel_steps" && rec.op === "update") return { data: [], error: null }
      if (rec.table === "funnel_steps") return { data: { doc_revision: 9 }, error: null }
      return { data: { id: "turn-1" }, error: null }
    })

    const result = await appendTurn({ stepId: STEP, expectedRevision: 4, role: "assistant", doc: doc() })

    expect(result).toEqual({ ok: false, reason: "stale_revision", currentRevision: 9 })
    expect(find("funnel_step_turns", "insert")).toBeUndefined()
    // MUTANT: drop the column from `readRevision`'s `.select("doc_revision")`.
    // Real PostgREST would return a row with no such key, `doc_revision ?? 0`
    // would report 0, and the client would be told to re-sync to a revision
    // that has not existed since the first turn — an unrecoverable 409 loop.
    expect(find("funnel_steps", "select")?.columns).toBe("doc_revision")
  })

  it("distinguishes a missing step from a stale revision", async () => {
    onQuery((rec) => {
      if (rec.table === "funnel_steps" && rec.op === "update") return { data: [], error: null }
      return { data: null, error: null }
    })

    expect(await appendTurn({ stepId: STEP, expectedRevision: 0, role: "user" })).toEqual({
      ok: false,
      reason: "not_found",
    })
  })

  it("validates the document BEFORE the swap, so a bad doc cannot move the revision", async () => {
    // MUTANT: validate after the compare-and-swap (or not at all). The
    // revision would advance and `project_data` would hold something the
    // renderer rejects, with the transcript recording it as a good turn.
    // `calls` being EMPTY is the assertion — not just that it threw.
    acceptSwapThenInsert()
    const broken = { v: 1, engine: "sections", theme: {}, sections: [] } as unknown as SectionDoc

    await expect(
      appendTurn({ stepId: STEP, expectedRevision: 4, role: "assistant", doc: broken }),
    ).rejects.toThrow()

    expect(calls).toHaveLength(0)
  })
})

describe("appendTurn — what it writes", () => {
  beforeEach(() => {
    onQuery((rec) => {
      if (rec.table === "funnel_steps") return { data: [{ doc_revision: 5 }], error: null }
      return { data: { id: "turn-1", revision: 5 }, error: null }
    })
  })

  it("writes the document into project_data and stamps the turn at expectedRevision + 1", async () => {
    const built = doc("Come back stronger")

    const result = await appendTurn({
      stepId: STEP,
      expectedRevision: 4,
      role: "assistant",
      message: "Added a hero.",
      ops: [{ op: "set_page" }],
      doc: built,
      compileStatus: "ok",
      unresolved: [],
      model: "claude-opus-5",
      tokensInput: 100,
      blocked: false,
      createdBy: "user-1",
    })

    expect(result).toMatchObject({ ok: true, revision: 5 })
    expect(find("funnel_steps", "update")?.payload?.project_data).toEqual(built)

    const insert = find("funnel_step_turns", "insert")?.payload
    expect(insert).toMatchObject({
      step_id: STEP,
      revision: 5,
      // Parent is the revision this turn was built FROM. An implementation
      // that stamped it with the NEW number would make the transcript a chain
      // of self-parents and break any future branch view.
      parent_revision: 4,
      role: "assistant",
      source: "ai",
      status: "complete",
      message: "Added a hero.",
      model: "claude-opus-5",
      created_by: "user-1",
    })
    expect(insert?.doc).toEqual(built)
    // MUTANT: drop `.select("*")` from the insert chain. `.single()` then
    // resolves with `data: null`, the cast hands the caller `turn: null` as an
    // `ok: true` result, and the chat renders an empty turn for a write that
    // actually landed.
    expect(find("funnel_step_turns", "insert")?.columns).toBe("*")
  })

  it("does NOT touch project_data on a turn that carries no document", async () => {
    // MUTANT: always setting `project_data`, which on a user turn or a failed
    // turn writes null over the owner's page. A user turn must move the
    // revision and nothing else.
    await appendTurn({
      stepId: STEP,
      expectedRevision: 4,
      role: "user",
      message: "make the headline bigger",
    })

    const payload = find("funnel_steps", "update")?.payload ?? {}
    expect(Object.keys(payload)).not.toContain("project_data")
    // Positive half: the revision still moved, so this is not passing because
    // the update never happened.
    expect(payload.doc_revision).toBe(5)
    expect(find("funnel_step_turns", "insert")?.payload?.doc).toBeNull()
  })

  it("defaults source to 'ai' and blocked to false without swallowing an explicit value", async () => {
    await appendTurn({
      stepId: STEP,
      expectedRevision: 4,
      role: "assistant",
      source: "inspector",
      status: "failed",
      blocked: true,
      errorMessage: "model refused",
    })

    expect(find("funnel_step_turns", "insert")?.payload).toMatchObject({
      source: "inspector",
      status: "failed",
      blocked: true,
      error_message: "model refused",
    })
  })
})

// ---------------------------------------------------------------------------

describe("listTurns", () => {
  it("takes the NEWEST turns and returns them oldest-first", async () => {
    // TWO mutants in one test, both one-liners:
    //   - `ascending: true` on the order: `.limit()` would then keep the
    //     OLDEST 200 and a busy page's chat would show none of today.
    //   - dropping the `.reverse()`: the transcript renders backwards.
    // The rows are returned in DESCENDING order, as the real query would.
    onQuery(() => ({
      data: [
        { id: "t3", revision: 3 },
        { id: "t2", revision: 2 },
        { id: "t1", revision: 1 },
      ],
      error: null,
    }))

    const turns = await listTurns(STEP)

    expect(turns.map((t) => t.revision)).toEqual([1, 2, 3])
    const q = find("funnel_step_turns", "select")
    expect(q?.order).toEqual({ column: "revision", ascending: false })
    expect(q?.filters).toEqual([["step_id", STEP]])
    // MUTANT: a narrowed column list. `listTurns` returns whole `FunnelStepTurn`
    // rows straight into the chat and into `revertToRevision`, so anything less
    // than `*` silently drops `doc` and makes every revert a no-doc refusal.
    expect(q?.columns).toBe("*")
  })

  it("bounds the read — an unbounded select on a per-turn growth table is a latent bug", async () => {
    // PostgREST caps `.select()` around 1000 rows and silently truncates.
    // MUTANT: delete the `.limit()`. Asserted against the literal 200 as well
    // as the exported constant, because comparing the query only against the
    // module's own constant is a tautology that survives someone raising it
    // past the cap it exists to stay under.
    onQuery(() => ({ data: [], error: null }))

    await listTurns(STEP)

    expect(find("funnel_step_turns", "select")?.limit).toBe(200)
    expect(TURN_HISTORY_LIMIT).toBe(200)
  })
})

// ---------------------------------------------------------------------------

describe("revertToRevision", () => {
  it("copies the old document FORWARD and appends a new head turn — nothing is deleted or rewound", async () => {
    const old = doc("The original headline")
    onQuery((rec) => {
      if (rec.table === "funnel_step_turns" && rec.op === "select") {
        return { data: { id: "t2", revision: 2, doc: old, compile_status: "ok" }, error: null }
      }
      if (rec.table === "funnel_steps" && rec.op === "select") {
        return { data: { doc_revision: 6 }, error: null }
      }
      if (rec.table === "funnel_steps" && rec.op === "update") {
        return { data: [{ doc_revision: 7 }], error: null }
      }
      return { data: { id: "turn-new", revision: 7 }, error: null }
    })

    const result = await revertToRevision({ stepId: STEP, toRevision: 2, createdBy: "user-1" })

    expect(result).toMatchObject({ ok: true, revision: 7 })
    // APPEND-ONLY. MUTANT: implementing undo as a delete of the turns above
    // the target, or by rewinding `doc_revision` to 2 — either makes undo
    // un-undoable and breaks the optimistic lock for every open tab.
    expect(calls.some((c) => c.op === "delete")).toBe(false)
    // MUTANT: narrowing `getTurnByRevision`'s `.select("*")`. The revert path
    // reads `doc`, `compile_status`, `compile_problems` and `unresolved` off
    // that row; a column list missing `doc` turns every legitimate undo into
    // `revision_has_no_doc`.
    expect(find("funnel_step_turns", "select")?.columns).toBe("*")
    const swap = find("funnel_steps", "update")
    expect(swap?.payload?.doc_revision).toBe(7)
    expect(swap?.payload?.project_data).toEqual(old)
    // ...and the CAS still guards it.
    expect(swap?.filters).toEqual([
      ["id", STEP],
      ["doc_revision", 6],
    ])

    const head = find("funnel_step_turns", "insert")?.payload
    expect(head).toMatchObject({ revision: 7, parent_revision: 6, source: "revert", role: "assistant" })
    expect(head?.doc).toEqual(old)
  })

  it("refuses a turn that carries NO document instead of clearing the page", async () => {
    // User turns and failed turns both have `doc IS NULL` and both are visible
    // in the chat, so a click can land on either. MUTANT: passing the null
    // through to `appendTurn`, which writes it and blanks the draft — and
    // because a null doc means "leave project_data alone" there, the failure
    // would be a revision bump with no visible change, i.e. an undo button
    // that silently does nothing.
    onQuery((rec) => {
      if (rec.table === "funnel_step_turns" && rec.op === "select") {
        return { data: { id: "t2", revision: 2, doc: null }, error: null }
      }
      return { data: null, error: null }
    })

    expect(await revertToRevision({ stepId: STEP, toRevision: 2 })).toEqual({
      ok: false,
      reason: "revision_has_no_doc",
    })
    expect(find("funnel_steps", "update")).toBeUndefined()
  })

  it("reports a revision that does not exist without writing anything", async () => {
    onQuery(() => ({ data: null, error: null }))

    expect(await revertToRevision({ stepId: STEP, toRevision: 99 })).toEqual({
      ok: false,
      reason: "revision_not_found",
    })
    expect(find("funnel_steps", "update")).toBeUndefined()
  })

  it("passes a concurrent write through as stale_revision rather than clobbering", async () => {
    onQuery((rec) => {
      if (rec.table === "funnel_step_turns" && rec.op === "select") {
        return { data: { id: "t2", revision: 2, doc: doc() }, error: null }
      }
      if (rec.table === "funnel_steps" && rec.op === "update") return { data: [], error: null }
      return { data: { doc_revision: 12 }, error: null }
    })

    expect(await revertToRevision({ stepId: STEP, toRevision: 2 })).toEqual({
      ok: false,
      reason: "stale_revision",
      currentRevision: 12,
    })
    expect(find("funnel_step_turns", "insert")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The review turn source.
//
// A TypeScript union and a Postgres CHECK constraint are two copies of one
// rule, and only one of them runs in production. Widening the union alone
// compiles green, passes every unit test, and then throws a constraint
// violation on the first real review — at which point the turn is lost and
// the owner sees a stream that ends in nothing.
// ---------------------------------------------------------------------------

describe("the review turn source", () => {
  const MIGRATION = "supabase/migrations/00209_funnel_review_turns.sql"

  it("is allowed by a migration, not only by TypeScript", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8")
    expect(sql).toContain("funnel_step_turns_source_check")
    expect(sql).toMatch(/'review'/)
  })

  it("keeps every source that already exists in the table", () => {
    // Dropping one would orphan every turn already written with it, and the
    // constraint would fail to apply against real data rather than failing
    // later — but only on a database that HAS such rows.
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8")
    for (const source of ["ai", "inspector", "revert"]) {
      expect(sql).toMatch(new RegExp(`'${source}'`))
    }
  })

  it("drops the old constraint before adding the new one", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8")
    expect(sql.indexOf("drop constraint")).toBeLessThan(sql.indexOf("add constraint"))
  })

  it("is in the TypeScript union too", () => {
    const source = readFileSync(join(process.cwd(), "lib/db/funnel-builder.ts"), "utf8")
    expect(source).toMatch(/export type TurnSource =[^\n]*"review"/)
  })
})
