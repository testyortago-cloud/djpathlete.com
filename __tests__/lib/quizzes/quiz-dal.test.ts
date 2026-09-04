// @vitest-environment node
// __tests__/lib/quizzes/quiz-dal.test.ts
//
// THE MOCK APPLIES THE FILTERS IT IS ASKED FOR, and that is the whole point of
// the file. A double that returns canned rows regardless of `.eq()` /
// `.in()` passes with the filter deleted — which is exactly how a privacy
// filter goes missing without a single test going red. Stage 3's facts layer
// was built this way for the same reason: `programs` has two visibility
// columns and the obvious accessor checks the wrong one.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §1
import { describe, it, expect, vi, beforeEach } from "vitest"
// `vi.mock` is hoisted above the imports, so a static import here still gets
// the mocked module. A top-level `await import(...)` also works at runtime but
// is a tsc error under this project's module setting — it cost one point off
// the 251 baseline before being caught.
import {
  getQuizDefinition,
  completeAttempt,
  getQuizDefinitionByKey,
  listQuizzes,
  getQuizzesByIds,
  createQuizFrom,
  deleteQuiz,
  saveQuizDefinition,
  getQuizAttemptCounts,
  createAttempt,
  QuizNotInBusinessError,
  getQuizDefinitionForEditor,
  getAnsweredQuestionIds,
} from "@/lib/db/quizzes"
import type { QuizDefinition } from "@/lib/quizzes/types"

/**
 * Task 8: the nine sites that pinned `SINGLETON_BUSINESS_ID` in this file, now
 * a required `businessId` first argument on every converted function. One
 * test per site, asserting the VALUE reaching `.eq("business_id", …)` (or,
 * for the two inserts, the value written into `business_id` itself) — never
 * just that a call happened. `eqCalls` below is an ARGUMENT-RECORDING mock,
 * not the FILTERING one `apply()` already does for `TABLES`: a mock that only
 * filters would silently pass if the predicate were dropped entirely, because
 * an unfiltered read and a correctly-filtered read of these fixtures can
 * return the same (empty, or all-rows) shape. Recording every `.eq()` call
 * lets each test assert the predicate was there AT ALL (the presence
 * control) and that its value was the one this call was given.
 */
const eqCalls: [string, unknown][] = []

type Row = Record<string, unknown>

/** Canned tables. Deliberately contains rows that MUST be filtered out. */
const TABLES: Record<string, Row[]> = {
  quizzes: [
    {
      id: "q1",
      business_id: "b1",
      key: "rpi-athlete-quiz",
      name: "RPI Athlete Quiz",
      status: "active",
      intro_headline: "Where is your performance leaking?",
      intro_body: "Twelve questions.",
      gate_headline: "Where should we send it?",
      gate_body: "",
      result_headline: "Your RPI",
      seed_marker: "reconstructed-from-ghl-export-2026-08-23",
    },
    // A SECOND QUIZ. Every read below must exclude it; a mock ignoring
    // `.eq("quiz_id")` would fold its rows into the first quiz's definition.
    { id: "q2", business_id: "b1", key: "other", name: "Other", status: "draft" },
  ],
  quiz_branches: [
    { id: "br1", quiz_id: "q1", key: "rebuilder", name: "Rebuilder", description: null, position: 1 },
    { id: "br2", quiz_id: "q1", key: "ceiling_breaker", name: "Ceiling Breaker", description: null, position: 2 },
    { id: "brX", quiz_id: "q2", key: "intruder", name: "Intruder", description: null, position: 1 },
  ],
  quiz_questions: [
    // Out of position order on purpose — the DAL must sort, not rely on the DB.
    { id: "qu2", quiz_id: "q1", branch_id: "br1", position: 50, prompt: "Rebuilder question", help_text: null, is_active: true },
    { id: "qu1", quiz_id: "q1", branch_id: null, position: 10, prompt: "Which describes you best?", help_text: null, is_active: true },
    { id: "quOff", quiz_id: "q1", branch_id: null, position: 20, prompt: "Retired question", help_text: null, is_active: false },
    { id: "quX", quiz_id: "q2", branch_id: null, position: 10, prompt: "Intruder question", help_text: null, is_active: true },
  ],
  quiz_options: [
    { id: "o2", question_id: "qu1", position: 2, label: "Coming back from injury", weight: 0, routes_to_branch_id: "br1", profile_id: null },
    { id: "o1", question_id: "qu1", position: 1, label: "Pushing higher", weight: 0, routes_to_branch_id: "br2", profile_id: null },
    { id: "o3", question_id: "qu2", position: 1, label: "Fully confident", weight: 3, routes_to_branch_id: null, profile_id: null },
    { id: "oX", question_id: "quX", position: 1, label: "Intruder option", weight: 9, routes_to_branch_id: null, profile_id: null },
  ],
  quiz_tiers: [
    { id: "t1", quiz_id: "q1", key: "red", position: 1, min_score: 0, max_score: 39, headline: "Red", body: "", cta_label: null, cta_href: null },
    { id: "tX", quiz_id: "q2", key: "red", position: 1, min_score: 0, max_score: 100, headline: "Intruder", body: "", cta_label: null, cta_href: null },
  ],
  quiz_profiles: [
    { id: "p1", quiz_id: "q1", key: "not_sure", name: "Not sure", description: "", position: 0 },
    { id: "pX", quiz_id: "q2", key: "intruder", name: "Intruder", description: "", position: 0 },
  ],
  quiz_attempts: [],
}

// `eqs` is a LIVE reference (not a snapshot) to the chain's own array, so a
// `.eq()` called after `.update()`/`.insert()`/`.delete()` (the normal
// chaining order) still shows up here by the time a test inspects `calls` --
// letting a test isolate ONE call's own predicate rather than reading the
// eqCalls the whole test run recorded across every table and every guard.
type Call = { table: string; op: string; payload?: Row; eqs: [string, unknown][] }
const calls: Call[] = []

function makeClient() {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = []
      const ins: [string, unknown[]][] = []
      let op = "select"
      let payload: Row | undefined

      const apply = () =>
        (TABLES[table] ?? []).filter(
          (row) =>
            eqs.every(([col, val]) => row[col] === val) &&
            ins.every(([col, vals]) => vals.includes(row[col] as never)),
        )

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val])
          // Recorded globally, in addition to the local `eqs` `apply()` already
          // filters on — this is the argument-RECORDING half, not the
          // filtering one. See the comment on `eqCalls` above.
          eqCalls.push([col, val])
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          ins.push([col, vals])
          return chain
        },
        order: () => chain,
        insert: (p: Row) => {
          op = "insert"
          payload = p
          calls.push({ table, op, payload, eqs })
          return chain
        },
        update: (p: Row) => {
          op = "update"
          payload = p
          calls.push({ table, op, payload, eqs })
          return chain
        },
        delete: () => {
          op = "delete"
          calls.push({ table, op, eqs })
          return chain
        },
        single: async () => {
          // `.insert({...}).select("id").single()` (createAttempt) has to get
          // the row it just wrote back, id included -- Postgres's own
          // `RETURNING` behaviour, which `apply()` against the unmodified
          // `TABLES` fixture cannot reproduce.
          if (op === "insert") return { data: { id: "generated-id", ...(payload as Row) }, error: null }
          if (op === "select") calls.push({ table, op, eqs })
          const rows = apply()
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } }
        },
        maybeSingle: async () => {
          if (op === "select") calls.push({ table, op, eqs })
          const rows = apply()
          return { data: rows[0] ?? null, error: null }
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          if (op === "select") calls.push({ table, op, eqs })
          return Promise.resolve(resolve({ data: apply(), error: null }))
        },
      }
      // insert(...).select().single() has to return the inserted row.
      chain.singleAfterInsert = chain.single
      return chain
    },
  }
}

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => makeClient() }))


beforeEach(() => {
  calls.length = 0
  eqCalls.length = 0
})

describe("getQuizDefinition", () => {
  it("returns only the named quiz's branches, tiers and profiles", async () => {
    const def = await getQuizDefinition("q1")
    expect(def).not.toBeNull()
    expect(def!.branches.map((b) => b.key)).toEqual(["rebuilder", "ceiling_breaker"])
    expect(def!.tiers.map((t) => t.key)).toEqual(["red"])
    expect(def!.profiles.map((p) => p.key)).toEqual(["not_sure"])
  })

  it("orders questions by position rather than trusting the row order", async () => {
    const def = await getQuizDefinition("q1")
    // MUTANT: drop the sort. The canned rows are deliberately out of order, so
    // this goes red — asserting the exact array, not that "a question came
    // back", because both orders return two questions.
    expect(def!.questions.map((q) => q.id)).toEqual(["qu1", "qu2"])
  })

  it("excludes a question that is not active", async () => {
    const def = await getQuizDefinition("q1")
    expect(def!.questions.map((q) => q.id)).not.toContain("quOff")
  })

  it("nests each question's own options, in position order", async () => {
    const def = await getQuizDefinition("q1")
    const router = def!.questions.find((q) => q.id === "qu1")!
    expect(router.options.map((o) => o.id)).toEqual(["o1", "o2"])
    expect(router.options.map((o) => o.routesToBranchId)).toEqual(["br2", "br1"])
    // An option belonging to the OTHER quiz's question must not appear here.
    expect(def!.questions.flatMap((q) => q.options.map((o) => o.id))).not.toContain("oX")
  })

  it("returns null for a quiz that does not exist, not a half-built object", async () => {
    expect(await getQuizDefinition("nope")).toBeNull()
  })
})

describe("completeAttempt", () => {
  it("writes the finished state, its own max_score, and a completed_at", async () => {
    await completeAttempt({
      attemptId: "a1",
      branchId: "br1",
      answers: [{ questionId: "qu1", optionId: "o2" }],
      rawScore: 6,
      maxScore: 12,
      score: 50,
      tierKey: "orange",
      profileKey: "not_sure",
      contactId: "c1",
    })
    const write = calls.find((c) => c.table === "quiz_attempts" && c.op === "update")
    expect(write, "no update was issued").toBeDefined()
    // Asserting WHICH values, not that an update happened. `max_score` is the
    // one that makes a past result immutable (spec §1.10) and is exactly the
    // field a careless refactor drops.
    expect(write!.payload).toMatchObject({
      status: "completed",
      score: 50,
      max_score: 12,
      raw_score: 6,
      tier_key: "orange",
      profile_key: "not_sure",
      contact_id: "c1",
    })
    expect(write!.payload!.completed_at).toEqual(expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// Task 8 — the nine sites, one test each. Every test uses "bbb" as the
// business it was given, DELIBERATELY not "b1" (the id baked into TABLES
// above): none of these assertions depend on which rows come back, only on
// the value that reached the query or the insert payload, so a business with
// no matching rows proves the point at least as well as one with rows would.
// ---------------------------------------------------------------------------

const minimalSource: QuizDefinition = {
  id: "src",
  key: "src",
  name: "Src",
  status: "draft",
  introHeadline: "",
  introBody: "",
  gateHeadline: "",
  gateBody: "",
  resultHeadline: "",
  seedMarker: null,
  branches: [],
  questions: [],
  tiers: [],
  profiles: [],
}

describe("getQuizDefinitionByKey", () => {
  it("scopes the read to the business it was given", async () => {
    await getQuizDefinitionByKey("bbb", "rpi-athlete-quiz")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0) // presence control
  })
})

describe("listQuizzes", () => {
  it("scopes the read to the business it was given", async () => {
    await listQuizzes("bbb")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0)
  })
})

describe("getQuizzesByIds", () => {
  it("scopes the read to the business it was given", async () => {
    await getQuizzesByIds("bbb", ["q1"])
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0)
  })
})

describe("createQuizFrom", () => {
  it("scopes the free-key read (uniqueQuizKey) and the insert to the business it was given", async () => {
    await createQuizFrom("bbb", { source: minimalSource, name: "Clone" })
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0)
    const insertCall = calls.find((c) => c.table === "quizzes" && c.op === "insert")
    expect(insertCall, "no insert was issued").toBeDefined()
    expect(insertCall!.payload!.business_id).toBe("bbb")
  })
})

describe("deleteQuiz", () => {
  it("scopes the delete to the business it was given", async () => {
    await deleteQuiz("bbb", "q1")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0)
  })
})

describe("saveQuizDefinition", () => {
  // "b1", not "bbb": the ownership guard added alongside this task's sweep
  // finding (child tables carry no `business_id` at all, so `quizId` must be
  // verified against the business before any write) means "q1" only accepts
  // the business it actually belongs to -- see TABLES.quizzes above.
  it("scopes the quiz content update to the business it was given", async () => {
    await saveQuizDefinition("b1", { quizId: "q1", quiz: { name: "Renamed" } })
    // Isolated to the UPDATE's OWN predicate, not the file-wide `eqCalls` --
    // `saveQuizDefinition` also runs the ownership guard's SELECT first,
    // which carries its own `.eq("business_id", …)`. Drawing both the value
    // AND the presence control from `eqCalls` let this test stay green with
    // the update's own predicate (lib/db/quizzes.ts's `quizzes` UPDATE)
    // deleted entirely, pinning the guard instead of the thing it was named
    // for -- two guards masking each other.
    const update = calls.find((c) => c.table === "quizzes" && c.op === "update")
    expect(update, "no update was issued").toBeDefined()
    const scoped = update!.eqs.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "b1")).toBe(true)
    expect(scoped).not.toHaveLength(0)
  })

  it("refuses a quiz that does not belong to the business it was given", async () => {
    // The sweep finding: quiz_questions/options/tiers/branches have no
    // business_id column, so this upfront check is the only thing stopping a
    // caller naming another business's quiz from structurally editing it.
    await expect(
      saveQuizDefinition("some-other-business", { quizId: "q1", quiz: { name: "Hijacked" } }),
    ).rejects.toThrow(QuizNotInBusinessError)
    // Nothing written -- the guard runs before any child table is touched.
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0)
  })
})

describe("getQuizAttemptCounts", () => {
  it("scopes the read to the business it was given", async () => {
    await getQuizAttemptCounts("bbb")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0)
  })
})

describe("createAttempt", () => {
  it("writes the business it was given onto the insert", async () => {
    await createAttempt("bbb", { quizId: "q1", attributionSessionId: null })
    const insertCall = calls.find((c) => c.table === "quiz_attempts" && c.op === "insert")
    expect(insertCall, "no insert was issued").toBeDefined() // presence control
    expect(insertCall!.payload!.business_id).toBe("bbb")
  })
})

// ---------------------------------------------------------------------------
// Fix round 1: `getQuizDefinitionForEditor` and `getAnsweredQuestionIds` were
// left unscoped in the first pass with the reasoning "several readers in this
// family have public callers". That reasoning does not cover these two: both
// have exactly two callers each, and both are admin-only (the quiz editor
// page and its save route). Unscoped, a staff coach holding the `funnels`
// permission (not an operator's OWNER_ONLY route -- see
// lib/permissions/registry.ts) could open ANY business's quiz editor by id.
// ---------------------------------------------------------------------------

describe("getQuizDefinitionForEditor", () => {
  it("scopes the read to the business it was given", async () => {
    await getQuizDefinitionForEditor("bbb", "q1")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0) // presence control
  })
})

describe("getAnsweredQuestionIds", () => {
  it("scopes the read to the business it was given", async () => {
    await getAnsweredQuestionIds("bbb", "q1")
    const scoped = eqCalls.filter(([c]) => c === "business_id")
    expect(scoped.every(([, v]) => v === "bbb")).toBe(true)
    expect(scoped).not.toHaveLength(0) // presence control
  })
})
