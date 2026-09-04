// @vitest-environment node
// __tests__/lib/quizzes/quiz-structural-save.test.ts
//
// `saveQuizDefinition` was UPDATES ONLY, and its docblock gave the reason:
// "a half-built version of it here would let a save silently drop an option a
// live page is already showing." That reason is what these tests are built
// around rather than something they work past.
//
// THE RULE: nothing anybody has answered is ever destroyed. Answers live in
// `quiz_attempts.answers`, a jsonb array with NO foreign keys, so the database
// will happily let a delete orphan them.
//
// Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §5
import { describe, it, expect, vi, beforeEach } from "vitest"
import { QuizAnsweredOptionError, saveQuizDefinition } from "@/lib/db/quizzes"

// Matches TABLES.quizzes' business_id below. Only "saveQuizDefinition — what
// it did not change" actually reaches the scoped `.eq("business_id", …)`
// update; every other call here exercises the child-table paths that are
// scoped by quiz_id instead, so the value only has to be consistent, not
// exercised by every test.
const BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

type Row = Record<string, unknown>

const TABLES: Record<string, Row[]> = {
  quizzes: [{ id: "q1", business_id: "00000000-0000-0000-0000-000000000001", key: "k", name: "Q", status: "draft" }],
  quiz_questions: [
    { id: "qu1", quiz_id: "q1", branch_id: null, position: 10, prompt: "Router", help_text: null, is_active: true },
    { id: "qu2", quiz_id: "q1", branch_id: "br1", position: 50, prompt: "Branch question", help_text: null, is_active: true },
    // Belongs to ANOTHER quiz. Nothing in this file may touch it.
    { id: "quX", quiz_id: "q2", branch_id: null, position: 10, prompt: "Intruder", help_text: null, is_active: true },
  ],
  quiz_options: [
    { id: "o1", question_id: "qu1", position: 1, label: "Picked by somebody", weight: 0, routes_to_branch_id: "br1", profile_id: null },
    { id: "o2", question_id: "qu1", position: 2, label: "Picked by nobody", weight: 0, routes_to_branch_id: "br1", profile_id: null },
    { id: "o3", question_id: "qu2", position: 1, label: "Also picked by nobody", weight: 3, routes_to_branch_id: null, profile_id: null },
    { id: "oX", question_id: "quX", position: 1, label: "Intruder option", weight: 9, routes_to_branch_id: null, profile_id: null },
  ],
  quiz_attempts: [
    // ONE REAL ATTEMPT. It names qu1 and o1 — so those two are the ones the
    // rule must protect, and qu2 / o2 / o3 are the ones it must let go.
    { id: "a1", quiz_id: "q1", answers: [{ questionId: "qu1", optionId: "o1" }], status: "completed" },
    // Another quiz's attempt, naming rows with the same shape. If the scan
    // forgets to filter by quiz_id, it protects rows nobody here answered.
    { id: "aX", quiz_id: "q2", answers: [{ questionId: "qu2", optionId: "o3" }], status: "completed" },
  ],
}

type Write = { table: string; op: string; payload?: unknown; eqs: [string, unknown][]; ins: [string, unknown[]][] }
const writes: Write[] = []
/** Every table a SELECT went to. See `settle`. */
const reads: string[] = []

const inserted = (table: string): Row[] =>
  writes.filter((w) => w.table === table && w.op === "insert").flatMap((w) => w.payload as Row[])
const updates = (table: string) => writes.filter((w) => w.table === table && w.op === "update")
const deletes = (table: string) => writes.filter((w) => w.table === table && w.op === "delete")

/** Every id a delete on `table` targeted, whether by `.eq("id")` or `.in()`. */
function deletedIds(table: string, column = "id"): string[] {
  return deletes(table).flatMap((w) => [
    ...w.eqs.filter(([col]) => col === column).map(([, val]) => String(val)),
    ...w.ins.filter(([col]) => col === column).flatMap(([, vals]) => vals.map(String)),
  ])
}

function makeClient() {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = []
      const ins: [string, unknown[]][] = []
      let op = "select"
      let payload: unknown

      const apply = () =>
        (TABLES[table] ?? []).filter(
          (row) =>
            eqs.every(([col, val]) => row[col] === val) &&
            ins.every(([col, vals]) => vals.includes(row[col] as never)),
        )

      const settle = () => {
        // READS ARE RECORDED TOO, and that is not bookkeeping for its own sake:
        // "this save does not touch the attempts table" is a claim about a
        // SELECT, and a harness that only logs writes reports it as true with
        // the guard deleted.
        if (op === "select") reads.push(table)
        else writes.push({ table, op, payload, eqs: [...eqs], ins: [...ins] })
        return { data: op === "select" ? apply() : null, error: null }
      }

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
        insert: (p: Row | Row[]) => {
          op = "insert"
          payload = Array.isArray(p) ? p : [p]
          return chain
        },
        update: (p: Row) => {
          op = "update"
          payload = p
          return chain
        },
        delete: () => {
          op = "delete"
          return chain
        },
        single: async () => {
          const rows = apply()
          return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
        },
        maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(settle())),
      }
      return chain
    },
  }
}

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => makeClient() }))

beforeEach(() => {
  writes.length = 0
  reads.length = 0
})

const NEW_QUESTION = {
  id: "new-q",
  branchId: null,
  position: 99,
  prompt: "How does the shoulder feel overhead?",
  helpText: null,
  isActive: false,
  options: [
    { id: "new-o1", position: 1, label: "Option 1", weight: 0, routesToBranchId: null, profileId: null },
    { id: "new-o2", position: 2, label: "Option 2", weight: 0, routesToBranchId: null, profileId: null },
  ],
}

describe("saveQuizDefinition — adding", () => {
  it("inserts a new question with its options in one save", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", addQuestions: [NEW_QUESTION] })
    expect(inserted("quiz_questions")[0]).toMatchObject({ id: "new-q", quiz_id: "q1", is_active: false })
    expect(inserted("quiz_options").map((o) => o.question_id)).toEqual(["new-q", "new-q"])
  })

  it("hangs the new question off the quiz being edited, whatever the payload says", async () => {
    // MUTANT: take quiz_id from the payload. A question could be inserted into
    // somebody else's quiz by a hand-crafted request.
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", addQuestions: [NEW_QUESTION] })
    expect(inserted("quiz_questions")[0].quiz_id).toBe("q1")
  })

  it("adds an option to an existing question", async () => {
    await saveQuizDefinition(BUSINESS_ID, {
      quizId: "q1",
      addOptions: [{ id: "new-o", questionId: "qu1", position: 3, label: "A third answer", weight: 2, routesToBranchId: null, profileId: null }],
    })
    expect(inserted("quiz_options")[0]).toMatchObject({ id: "new-o", question_id: "qu1", label: "A third answer", weight: 2 })
  })

  it("refuses to add an option to another quiz's question", async () => {
    // MUTANT: insert without checking ownership. quX belongs to q2.
    await saveQuizDefinition(BUSINESS_ID, {
      quizId: "q1",
      addOptions: [{ id: "x", questionId: "quX", position: 1, label: "Intruder", weight: 9, routesToBranchId: null, profileId: null }],
    })
    expect(inserted("quiz_options")).toHaveLength(0)
  })

  it("inserts before it updates, so a row added in this save can be edited by it", async () => {
    await saveQuizDefinition(BUSINESS_ID, {
      quizId: "q1",
      addQuestions: [NEW_QUESTION],
      questions: [{ id: "qu1", prompt: "Reworded" }],
    })
    const firstInsert = writes.findIndex((w) => w.op === "insert")
    const firstUpdate = writes.findIndex((w) => w.op === "update")
    expect(firstInsert).toBeLessThan(firstUpdate)
  })
})

describe("saveQuizDefinition — deleting", () => {
  it("hard-deletes a question nobody has answered, and its options with it", async () => {
    const result = await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteQuestionIds: ["qu2"] })
    expect(deletedIds("quiz_options", "question_id")).toContain("qu2")
    expect(deletedIds("quiz_questions")).toContain("qu2")
    expect(result.retiredQuestionIds).toEqual([])
  })

  it("RETIRES a question somebody has answered instead of destroying it", async () => {
    // MUTANT: delete it anyway. Past SCORES survive — raw_score and max_score
    // are frozen on the attempt — but a report mapping an answer back to its
    // prompt finds a hole where the question used to be.
    const result = await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteQuestionIds: ["qu1"] })
    expect(deletedIds("quiz_questions")).not.toContain("qu1")
    expect(updates("quiz_questions").some((w) => (w.payload as Row).is_active === false)).toBe(true)
    expect(result.retiredQuestionIds).toEqual(["qu1"])
  })

  it("deletes an option nobody picked", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteOptionIds: ["o2"] })
    expect(deletedIds("quiz_options")).toContain("o2")
  })

  it("refuses to delete an answered option, and names it", async () => {
    await expect(saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteOptionIds: ["o1"] })).rejects.toThrow(QuizAnsweredOptionError)
  })

  it("writes NOTHING when it refuses", async () => {
    // MUTANT: run the refuse-check after the writes. The rename lands, the save
    // reports failure, and the editor and the database now disagree about a
    // save the owner was told did not happen.
    await expect(
      saveQuizDefinition(BUSINESS_ID, { quizId: "q1", quiz: { name: "Should not be written" }, deleteOptionIds: ["o1"] }),
    ).rejects.toThrow(QuizAnsweredOptionError)
    expect(writes).toHaveLength(0)
  })

  it("only counts answers from THIS quiz's attempts", async () => {
    // MUTANT: scan every attempt rather than this quiz's. Another quiz's
    // attempt names o3, so deleting an option nobody here ever picked would be
    // refused, and the owner could never remove it.
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteOptionIds: ["o3"] })
    expect(deletedIds("quiz_options")).toContain("o3")
  })

  it("deletes last, so an earlier edit in the same save still lands", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", questions: [{ id: "qu1", prompt: "Reworded" }], deleteQuestionIds: ["qu2"] })
    const lastUpdate = writes.map((w) => w.op).lastIndexOf("update")
    const firstDelete = writes.findIndex((w) => w.op === "delete")
    expect(lastUpdate).toBeLessThan(firstDelete)
  })

  it("touches nothing at all when asked to delete another quiz's question", async () => {
    // MUTANT KILLED: drop the `ownedQuestionIds.has` guard. The question
    // delete is scoped by quiz_id and no-ops, but the OPTION delete is keyed
    // on question_id and is not — so a hand-crafted payload would strip
    // another quiz's answers off its live page while appearing to do nothing.
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteQuestionIds: ["quX"] })
    expect(writes.filter((w) => w.op === "delete")).toHaveLength(0)
  })

  it("scopes the question delete by quiz as well as by id", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteQuestionIds: ["qu2"] })
    const del = deletes("quiz_questions")[0]
    expect(del?.eqs.some(([col, val]) => col === "quiz_id" && val === "q1")).toBe(true)
  })

  it("scopes the option delete through this quiz's questions", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", deleteOptionIds: ["o2"] })
    const del = deletes("quiz_options")[0]
    expect(del?.ins.some(([col]) => col === "question_id")).toBe(true)
  })
})

describe("saveQuizDefinition — what it did not change", () => {
  it("still applies a plain content edit with no structural payload at all", async () => {
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", quiz: { name: "Renamed" } })
    // Nor does it read this quiz's questions: nothing here needs ownership.
    expect(reads).not.toContain("quiz_questions")
    expect(updates("quizzes")[0].payload).toMatchObject({ name: "Renamed" })
    expect(writes.filter((w) => w.op === "delete")).toHaveLength(0)
    expect(writes.filter((w) => w.op === "insert")).toHaveLength(0)
  })

  it("does not read the attempts at all when nothing is being deleted", async () => {
    // The scan is O(attempts). A save that deletes nothing must not pay for it.
    // MUTANT KILLED: run `answeredIds` unconditionally.
    await saveQuizDefinition(BUSINESS_ID, { quizId: "q1", quiz: { name: "Renamed" } })
    expect(reads).not.toContain("quiz_attempts")
  })
})
