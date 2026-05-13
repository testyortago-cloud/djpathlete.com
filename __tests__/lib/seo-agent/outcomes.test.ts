import { describe, expect, it, vi, beforeEach } from "vitest"

const supabaseFromMock = vi.fn()
const firestoreDocGet = vi.fn()
const firestoreCollectionMock = vi.fn(() => ({ doc: () => ({ get: firestoreDocGet }) }))

const supabase = {
  from: supabaseFromMock,
} as unknown as import("@supabase/supabase-js").SupabaseClient

const firestore = {
  collection: firestoreCollectionMock,
} as unknown as import("firebase-admin/firestore").Firestore

beforeEach(() => {
  supabaseFromMock.mockReset()
  firestoreDocGet.mockReset()
  firestoreCollectionMock.mockClear()
})

// ─── resolveNewPostOutcome ─────────────────────────────────────────────────

describe("resolveNewPostOutcome", () => {
  it("returns { note: not_picked_up } when content_calendar.reference_id is null", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "cc-1", reference_id: null, status: "planned" },
                  error: null,
                }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveNewPostOutcome("cc-1", supabase)
    expect(out).toEqual({
      executed: true,
      target_id: null,
      note: "topic_suggestion_not_yet_picked_up",
    })
  })

  it("returns clicks/position window when reference_id resolves to a published post", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    const publishedAt = new Date(Date.now() - 21 * 86400 * 1000).toISOString()
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "content_calendar") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "cc-1", reference_id: "post-1", status: "published" },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "deadlift-tips", published_at: publishedAt },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [
                      { clicks: 3, impressions: 50, position: 12 },
                      { clicks: 5, impressions: 80, position: 11 },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveNewPostOutcome("cc-1", supabase)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(0)
    expect(out.clicks_after).toBe(8) // 3 + 5
    expect(out.position_before).toBeNull()
    expect(typeof out.position_after).toBe("number")
  })

  it("returns error when content_calendar row missing", async () => {
    const { resolveNewPostOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }))
    const out = await resolveNewPostOutcome("missing", supabase)
    expect(out.executed).toBe(true)
    expect(out.error).toMatch(/content_calendar row not found/i)
  })
})

// ─── resolveRefreshOutcome ─────────────────────────────────────────────────

describe("resolveRefreshOutcome", () => {
  it("returns before/after clicks based on blog_posts.last_refreshed_at", async () => {
    const { resolveRefreshOutcome } = await import("@/lib/seo-agent/outcomes")
    const lastRefreshedAt = new Date(Date.now() - 14 * 86400 * 1000).toISOString()
    firestoreDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ input: { blogPostId: "post-1" }, status: "completed" }),
    })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "deadlift-tips", last_refreshed_at: lastRefreshedAt },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [{ clicks: 4, impressions: 60, position: 14 }],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveRefreshOutcome("ai-job-1", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(4)
    expect(out.clicks_after).toBe(4)
    expect(typeof out.position_before).toBe("number")
    expect(typeof out.position_after).toBe("number")
  })

  it("returns error when Firestore ai_jobs doc not found", async () => {
    const { resolveRefreshOutcome } = await import("@/lib/seo-agent/outcomes")
    firestoreDocGet.mockResolvedValueOnce({ exists: false, data: () => null })
    const out = await resolveRefreshOutcome("missing-job", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.error).toMatch(/ai_job not found/i)
  })
})

// ─── resolveLinkSweepOutcome ───────────────────────────────────────────────

describe("resolveLinkSweepOutcome", () => {
  it("returns before/after windows centered on the memo's run_date", async () => {
    const { resolveLinkSweepOutcome } = await import("@/lib/seo-agent/outcomes")
    firestoreDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ input: { targetBlogPostId: "post-1" }, status: "completed" }),
    })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "blog_posts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "post-1", slug: "target-post" },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "gsc_query_daily") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () =>
                  Promise.resolve({
                    data: [{ clicks: 2, impressions: 40, position: 18 }],
                    error: null,
                  }),
              }),
            }),
          }),
        }
      }
      return {}
    })
    const out = await resolveLinkSweepOutcome("ai-job-2", "2026-05-01", supabase, firestore)
    expect(out.executed).toBe(true)
    expect(out.target_id).toBe("post-1")
    expect(out.clicks_before).toBe(2)
    expect(out.clicks_after).toBe(2)
  })
})

// ─── resolveFlagOutcome ────────────────────────────────────────────────────

describe("resolveFlagOutcome", () => {
  it("returns acknowledged=true when notification is_read=true", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "notif-1", is_read: true }, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("notif-1", supabase)
    expect(out).toEqual({ executed: true, target_id: "notif-1", acknowledged: true })
  })

  it("returns acknowledged=false when is_read=false", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "notif-1", is_read: false }, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("notif-1", supabase)
    expect(out.acknowledged).toBe(false)
  })

  it("returns error when notification not found", async () => {
    const { resolveFlagOutcome } = await import("@/lib/seo-agent/outcomes")
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }))
    const out = await resolveFlagOutcome("missing", supabase)
    expect(out.error).toMatch(/notification not found/i)
  })
})
