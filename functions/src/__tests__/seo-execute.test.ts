import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()
const firestoreDocSet = vi.fn()
const firestoreCollectionDoc = vi.fn(() => ({ id: "new-doc-id", set: firestoreDocSet }))

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({ from: supabaseFromMock }),
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: vi.fn(() => ({ doc: firestoreCollectionDoc })),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  supabaseFromMock.mockReset()
  firestoreDocSet.mockReset()
  firestoreCollectionDoc.mockClear()
})

describe("executeQueueNewPost", () => {
  it("inserts a topic_suggestion row, returns execution_target_id", async () => {
    const { executeQueueNewPost } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "cc-id-1" }, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await executeQueueNewPost(
      { keyword: "deadlift", angle: "biomechanics" },
      { memoId: "memo-1", userId: "u", businessId: "biz-1" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "cc-id-1" })
  })

  it("returns executed=false on supabase error", async () => {
    const { executeQueueNewPost } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
      }),
    }))
    const out = await executeQueueNewPost(
      { keyword: "x", angle: "y" },
      { memoId: "memo-1", userId: "u", businessId: "biz-1" },
    )
    expect(out).toMatchObject({ executed: false, execution_target_id: null, error: "boom" })
  })
})

describe("executeQueueRefresh", () => {
  it("creates a Firestore ai_job and returns its id", async () => {
    const { executeQueueRefresh } = await import("../seo/execute.js")
    firestoreDocSet.mockResolvedValueOnce(undefined)
    const out = await executeQueueRefresh(
      { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "decay" },
      { memoId: "memo-1", userId: "u", businessId: "biz-1" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "new-doc-id" })
    const arg = firestoreDocSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe("blog_refresh")
    expect(arg.triggeredBy).toBe("seo_agent_run")
    expect((arg.input as Record<string, unknown>).blogPostId).toBe("11111111-1111-1111-1111-111111111111")
  })
})

describe("executeQueueInternalLinkSweep", () => {
  it("creates a Firestore ai_job with type=internal_link_sweep", async () => {
    const { executeQueueInternalLinkSweep } = await import("../seo/execute.js")
    firestoreDocSet.mockResolvedValueOnce(undefined)
    const out = await executeQueueInternalLinkSweep(
      {
        target_blog_post_id: "11111111-1111-1111-1111-111111111111",
        candidate_anchor_post_ids: ["22222222-2222-2222-2222-222222222222"],
      },
      { memoId: "memo-1", userId: "u", businessId: "biz-1" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "new-doc-id" })
    const arg = firestoreDocSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe("internal_link_sweep")
  })
})

describe("executeFlagForHuman", () => {
  // G35. The flag goes to the OWNERS of the job's business, through
  // notifyBusinessOwners (its own suite pins the read). This fake answers
  // business_members the way the table would — filtered by what the caller
  // asked for — so these tests can tell WHICH business reached the read.
  // owner-1 owns biz-1; owner-2 owns biz-2, where coach-2 also works.
  function routeOwnersAndNotifications() {
    const inserted: Array<Record<string, unknown>> = []
    const members = [
      { business_id: "biz-1", user_id: "owner-1", role: "owner" },
      { business_id: "biz-2", user_id: "owner-2", role: "owner" },
      { business_id: "biz-2", user_id: "coach-2", role: "coach" },
    ]
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "business_members") {
        const filters: Array<[string, unknown]> = []
        const builder = {
          select: (_columns: string) => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return builder
          },
          order: (_column: string, _o?: unknown) => builder,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({
              data: members
                .filter((m) => filters.every(([c, v]) => (m as Record<string, unknown>)[c] === v))
                .map((m) => ({ user_id: m.user_id })),
              error: null,
            }).then(resolve, reject),
        }
        return builder
      }
      if (table === "notifications") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            inserted.push(...rows)
            return {
              select: (_columns: string) =>
                Promise.resolve({
                  data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })),
                  error: null,
                }),
            }
          },
        }
      }
      return {}
    })
    return inserted
  }

  // MUTANT: read ctx.userId, or the platform business, in place of
  // ctx.businessId. Either one finds no owner of biz-2 (or the wrong one).
  it("bells the owners of ctx.businessId and returns that row's id", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    const inserted = routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "Cannibalization", urgency: "medium", context: "Posts A and B compete on keyword X" },
      { memoId: "memo-1", userId: "u", businessId: "biz-2" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "notif-owner-2" })
    expect(inserted).toEqual([
      {
        user_id: "owner-2",
        type: "info",
        title: "SEO Agent: Cannibalization",
        message: "Posts A and B compete on keyword X",
        link: "/admin/seo-agent/memos",
        is_read: false,
      },
    ])
  })

  // MUTANT: default a missing businessId to the platform business (the
  // functions twin of SINGLETON_BUSINESS_ID). A job enqueued before G35 has
  // no businessId, and its alert is skipped rather than sent to a guess.
  // Presence control: the test above reaches the database for the same action.
  it("fails closed for a job with no businessId: no read, no insert, a reason", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "high", context: "y" },
      { memoId: "memo-1", userId: "u", businessId: null },
    )
    expect(out.executed).toBe(false)
    expect(out.execution_target_id).toBeNull()
    expect(out.error).toMatch(/no businessId/)
    expect(supabaseFromMock).not.toHaveBeenCalled()
  })

  it("returns executed=false, with the helper's reason, when the business has no owner", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    const inserted = routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "low", context: "y" },
      { memoId: "memo-1", userId: "u", businessId: "biz-3" },
    )
    expect(out).toEqual({
      executed: false,
      execution_target_id: null,
      error: "business biz-3 has no owner to notify",
    })
    expect(inserted).toEqual([])
  })
})

describe("executeAction (dispatcher)", () => {
  it("dispatches to the correct tool executor by action.tool", async () => {
    const { executeAction } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "cc-id" }, error: null }) }),
      }),
    }))
    const out = await executeAction(
      { rank: 1, tool: "queue_new_post", args: { keyword: "k", angle: "a" } },
      { memoId: "memo-1", userId: "u", businessId: "biz-1" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "cc-id" })
  })
})
