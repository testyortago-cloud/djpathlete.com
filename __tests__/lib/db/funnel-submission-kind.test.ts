// TWO CLAIMS, and the second is the one that costs a lead if it is wrong.
//
// 1. A quiz completion is stored AS a quiz completion: `kind: 'quiz'` and the
//    attempt it came from.
// 2. Migrations and Vercel deploys race on merge to main, so for one deploy
//    production can run this code against the pre-00230 schema. PostgREST
//    answers an unknown column with PGRST204 and rejects the WHOLE insert --
//    which would mean the quiz lead is not merely unlabelled, it is GONE.
//    Losing the label is acceptable; losing the lead is not.
import { describe, it, expect, vi, beforeEach } from "vitest"

const inserted: Record<string, unknown>[] = []
let nextError: { code?: string; message?: string } | null = null

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        inserted.push(payload)
        const error = nextError
        nextError = null
        return {
          select: () => ({
            single: async () => (error ? { data: null, error } : { data: { id: "sub-1", ...payload }, error: null }),
          }),
        }
      },
    }),
  }),
}))

import { createSubmission } from "@/lib/db/funnels"

const BASE = {
  funnel_id: "11111111-1111-4111-8111-111111111111",
  step_id: "22222222-2222-4222-8222-222222222222",
  form_key: "rpi_athlete_quiz",
  payload: { "How many sessions?": "Three" },
}
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  inserted.length = 0
  nextError = null
})

describe("createSubmission", () => {
  it("stores a quiz completion as a quiz completion", async () => {
    await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: ATTEMPT_ID })
    expect(inserted[0].kind).toBe("quiz")
    expect(inserted[0].quiz_attempt_id).toBe(ATTEMPT_ID)
  })

  it("defaults a caller that says nothing to a form fill", async () => {
    await createSubmission(BASE)
    expect(inserted[0].kind).toBe("form")
    expect(inserted[0].quiz_attempt_id).toBeNull()
  })

  it("keeps the lead when the columns do not exist yet, dropping only the label", async () => {
    // THE MESSAGE NAMES NO COLUMN, deliberately. The guard has two clauses --
    // the code and the quoted column name -- and a fixture that satisfied both
    // would leave either one deletable with every test still green.
    nextError = { code: "PGRST204", message: "schema cache is stale" }
    const row = await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: ATTEMPT_ID })
    expect(inserted).toHaveLength(2)
    expect(Object.keys(inserted[1])).not.toContain("kind")
    expect(Object.keys(inserted[1])).not.toContain("quiz_attempt_id")
    // The visitor's answers and the funnel it happened on survive the retry --
    // a retry that dropped the payload would keep a row and lose the lead.
    expect(inserted[1].payload).toEqual(BASE.payload)
    expect(inserted[1].funnel_id).toBe(BASE.funnel_id)
    expect(inserted[1].email).toBeNull()
    expect(row.id).toBe("sub-1")
  })

  it("recognises the pre-00230 schema by the column name too, not only the code", async () => {
    // PostgREST's code has changed shape before. The message names the column
    // in quotes, which is the same belt-and-braces pair lib/db/lead-inquiries
    // uses for the 00211 click ids.
    nextError = { code: "SOMETHING_ELSE", message: "column 'quiz_attempt_id' does not exist" }
    await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: ATTEMPT_ID })
    expect(inserted).toHaveLength(2)
  })

  it("does not retry an error that is not about a missing column", async () => {
    // A retry on a real failure -- a broken FK, a violated CHECK, the unique
    // index on quiz_attempt_id -- would send the same doomed insert twice and
    // report the second failure, hiding the first.
    nextError = { code: "23503", message: "insert violates foreign key constraint" }
    await expect(createSubmission({ ...BASE, kind: "quiz" })).rejects.toThrow(/foreign key/)
    expect(inserted).toHaveLength(1)
  })

  it("carries the PostgREST code on the thrown error, so a duplicate is tellable from a failure", async () => {
    // The unique index on quiz_attempt_id is what makes one completion one
    // lead. Its caller needs to tell 23505 ("already recorded") from a real
    // failure, and the house convention of throwing a bare message loses that.
    nextError = { code: "23505", message: "duplicate key value violates unique constraint" }
    await createSubmission({ ...BASE, kind: "quiz", quiz_attempt_id: ATTEMPT_ID }).then(
      () => expect.fail("should have thrown"),
      (error: { code?: string }) => expect(error.code).toBe("23505"),
    )
  })
})
