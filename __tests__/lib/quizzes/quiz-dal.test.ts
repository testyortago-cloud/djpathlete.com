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
import { getQuizDefinition, completeAttempt } from "@/lib/db/quizzes"

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

type Call = { table: string; op: string; payload?: Row }
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
          calls.push({ table, op, payload })
          return chain
        },
        update: (p: Row) => {
          op = "update"
          payload = p
          calls.push({ table, op, payload })
          return chain
        },
        single: async () => {
          if (op === "select") calls.push({ table, op })
          const rows = apply()
          return rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } }
        },
        maybeSingle: async () => {
          if (op === "select") calls.push({ table, op })
          const rows = apply()
          return { data: rows[0] ?? null, error: null }
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          if (op === "select") calls.push({ table, op })
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
