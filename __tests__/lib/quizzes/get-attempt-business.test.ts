// @vitest-environment node
//
// getAttempt must SELECT and RETURN quiz_attempts.business_id. The submit
// route inherits the attempt's business for every write it makes, which is
// what keeps the attempt, the contact, the pipeline card and the consent row
// on one tenant by construction. A fixture id distinct from the platform's is
// the presence control: the platform id would pass for a route that ignored
// the row and fell back to a default.
import { describe, it, expect, vi } from "vitest"

const OTHER_BUSINESS_ID = "22222222-2222-4222-8222-222222222222"
const selectMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: (cols: string) => {
        selectMock(cols)
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "a1",
                quiz_id: "q1",
                branch_id: null,
                status: "in_progress",
                answers: [],
                business_id: OTHER_BUSINESS_ID,
              },
              error: null,
            }),
          }),
        }
      },
    }),
  }),
}))

import { getAttempt } from "@/lib/db/quizzes"

describe("getAttempt", () => {
  it("selects and returns the attempt's business_id so the submit route can inherit it", async () => {
    const row = await getAttempt("a1")
    expect(selectMock).toHaveBeenCalledTimes(1)
    expect(selectMock.mock.calls[0][0]).toContain("business_id")
    expect(row?.businessId).toBe(OTHER_BUSINESS_ID)
  })
})
