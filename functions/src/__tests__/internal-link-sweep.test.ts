import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()
const callAgentMock = vi.fn()
const jobRefGet = vi.fn()
const jobRefUpdate = vi.fn()

vi.mock("../lib/supabase.js", () => ({
  getSupabase: () => ({ from: supabaseFromMock }),
}))
vi.mock("../ai/anthropic.js", () => ({
  callAgent: callAgentMock,
  MODEL_SONNET: "claude-sonnet-4-6",
}))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: () => ({ get: jobRefGet, update: jobRefUpdate }) }),
  }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))

beforeEach(() => {
  supabaseFromMock.mockReset()
  callAgentMock.mockReset()
  jobRefGet.mockReset()
  jobRefUpdate.mockReset()
})

// Helper: build a stub supabase factory that returns the right shape per call.
// `posts` is keyed by blog_posts id and represents the rows in the DB.
// `updates` collects the .update() payloads keyed by post id.
function buildSupabaseStub(
  posts: Record<string, { id: string; slug: string; title: string; content: string }>,
  updates: Array<{ id: string; content: string }>,
) {
  return (table: string) => {
    if (table === "blog_posts") {
      return {
        select: () => ({
          eq: (_col: string, value: string) => ({
            single: () =>
              Promise.resolve({
                data: posts[value] ?? null,
                error: posts[value] ? null : { message: "no row" },
              }),
          }),
          in: (_col: string, ids: string[]) => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: ids.map((id) => posts[id]).filter(Boolean),
                  error: null,
                }),
            }),
          }),
        }),
        update: (payload: { content: string }) => ({
          eq: (_col: string, value: string) => {
            updates.push({ id: value, content: payload.content })
            return Promise.resolve({ error: null })
          },
        }),
      }
    }
    if (table === "ai_generation_log") {
      return { insert: () => Promise.resolve({ error: null }) }
    }
    return {}
  }
}

describe("handleInternalLinkSweep", () => {
  it("happy path: 3 candidates, 2 successful insertions, stops after 2", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1", "c2", "c3"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Bracing matters when you deadlift.</p>" },
      c2: { id: "c2", slug: "warmup", title: "Warmup", content: "<p>Warm up before any heavy deadlift.</p>" },
      c3: { id: "c3", slug: "recovery", title: "Recovery", content: "<p>No mention of the target word.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    // Claude returns valid anchors for c1 and c2 but stops being called after 2 successes.
    callAgentMock
      .mockResolvedValueOnce({ content: { anchor: "deadlift", reason: "ok" }, tokens_used: 10 })
      .mockResolvedValueOnce({ content: { anchor: "deadlift", reason: "ok" }, tokens_used: 10 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-1")

    expect(updates).toHaveLength(2)
    expect(updates[0].id).toBe("c1")
    expect(updates[0].content).toContain('<a href="/blog/deadlift-tips">deadlift</a>')
    expect(updates[1].id).toBe("c2")
    expect(callAgentMock).toHaveBeenCalledTimes(2)

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { insertions: number }).insertions).toBe(2)
  })

  it("skips candidates where Claude returns null anchor", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1", "c2"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Some content.</p>" },
      c2: { id: "c2", slug: "warmup", title: "Warmup", content: "<p>Brace before any deadlift.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    callAgentMock
      .mockResolvedValueOnce({ content: { anchor: null }, tokens_used: 5 })
      .mockResolvedValueOnce({ content: { anchor: "deadlift" }, tokens_used: 10 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-2")

    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe("c2")
  })

  it("skips when Claude returns an anchor that is not a substring of the candidate body", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "target-id",
          candidateAnchorPostIds: ["c1"],
          userId: "admin-uuid",
        },
      }),
    })
    jobRefGet.mockResolvedValue({ exists: true, data: () => ({ status: "processing" }) })

    const posts = {
      "target-id": { id: "target-id", slug: "deadlift-tips", title: "Deadlift tips", content: "" },
      c1: { id: "c1", slug: "form-101", title: "Form 101", content: "<p>Squat depth matters.</p>" },
    }
    const updates: Array<{ id: string; content: string }> = []
    supabaseFromMock.mockImplementation(buildSupabaseStub(posts, updates))

    // Claude hallucinates an anchor not present in the candidate body
    callAgentMock.mockResolvedValueOnce({ content: { anchor: "deadlift bracing" }, tokens_used: 5 })

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-3")

    expect(updates).toHaveLength(0)
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { insertions: number }).insertions).toBe(0)
  })

  it("marks job failed when the target post doesn't exist", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        status: "pending",
        type: "internal_link_sweep",
        input: {
          targetBlogPostId: "missing-id",
          candidateAnchorPostIds: ["c1"],
          userId: "u",
        },
      }),
    })
    supabaseFromMock.mockImplementation(buildSupabaseStub({}, []))

    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("job-4")

    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; error?: string }
    expect(finalUpdate?.status).toBe("failed")
    expect(finalUpdate?.error).toMatch(/target post not found/i)
  })

  it("bails when job is not pending", async () => {
    jobRefGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "completed", type: "internal_link_sweep", input: {} }),
    })
    const { handleInternalLinkSweep } = await import("../internal-link-sweep.js")
    await handleInternalLinkSweep("done-job")
    expect(callAgentMock).not.toHaveBeenCalled()
  })
})
