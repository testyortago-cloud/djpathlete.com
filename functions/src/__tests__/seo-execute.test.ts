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
      { memoId: "memo-1", userId: "u" },
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
      { memoId: "memo-1", userId: "u" },
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
      { memoId: "memo-1", userId: "u" },
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
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "new-doc-id" })
    const arg = firestoreDocSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe("internal_link_sweep")
  })
})

describe("executeFlagForHuman", () => {
  it("inserts a notification row and returns its id (when admin user resolvable)", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [{ id: "admin-uuid" }], error: null }),
            }),
          }),
        }
      }
      if (table === "notifications") {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "notif-1" }, error: null }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await executeFlagForHuman(
      { issue: "Cannibalization", urgency: "medium", context: "Posts A and B compete on keyword X" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "notif-1" })
  })

  it("returns executed=false when no admin user found", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }))
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "low", context: "y" },
      { memoId: "memo-1", userId: "u" },
    )
    expect(out.executed).toBe(false)
    expect(out.error).toMatch(/no admin user/i)
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
      { memoId: "memo-1", userId: "u" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "cc-id" })
  })
})
