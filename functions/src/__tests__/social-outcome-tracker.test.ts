import { describe, it, expect, vi } from "vitest"

vi.mock("../lib/supabase.js", () => ({ getSupabase: vi.fn() }))

import { runSocialOutcomeTracker } from "../social-outcome-tracker.js"
import { collectMemoPostIds } from "../social-outcome-tracker.js"
import { getSupabase } from "../lib/supabase.js"

describe("collectMemoPostIds", () => {
  it("returns the legacy memo.social_post_id when set", () => {
    expect(
      collectMemoPostIds({ social_post_id: "legacy-1", actions: null }),
    ).toEqual(["legacy-1"])
  })

  it("falls back to actions[].payload.social_post_id when social_post_id is null", () => {
    expect(
      collectMemoPostIds({
        social_post_id: null,
        actions: [
          {
            kind: "drafted_social_post",
            payload: { social_post_id: "p-linkedin" },
          },
          {
            kind: "drafted_social_post",
            payload: { social_post_id: "p-tiktok" },
          },
        ],
      }),
    ).toEqual(["p-linkedin", "p-tiktok"])
  })

  it("ignores action entries with the wrong kind", () => {
    expect(
      collectMemoPostIds({
        social_post_id: null,
        actions: [
          {
            kind: "drafted_social_post",
            payload: { social_post_id: "good" },
          },
          { kind: "no_eligible_topic", payload: {} },
          // missing kind
          { payload: { social_post_id: "skipped" } },
        ],
      }),
    ).toEqual(["good"])
  })

  it("returns an empty array when both sources are missing", () => {
    expect(collectMemoPostIds({ social_post_id: null, actions: null })).toEqual([])
    expect(collectMemoPostIds({ social_post_id: null, actions: [] })).toEqual([])
  })
})

describe("runSocialOutcomeTracker", () => {
  it("marks each aged pending memo as measured and writes impact_score (legacy social_post_id path)", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
      eq: vi.fn().mockImplementation((_col: string, id: string) => {
        updates.push({ id, patch })
        return Promise.resolve({ data: null, error: null })
      }),
    }))
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const aged = [
      { id: "m1", social_post_id: "p1", actions: null },
      { id: "m2", social_post_id: "p2", actions: null },
    ]
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "outcome_status" && val === "pending") {
                  return {
                    lt: vi.fn().mockResolvedValue({ data: aged, error: null }),
                  }
                }
                // measured + 90-day window for refreshSocialBaseline
                return {
                  gte: vi.fn().mockResolvedValue({
                    data: [
                      { outcome_metrics: { engagement_delta: 12.5 } },
                      { outcome_metrics: { engagement_delta: -3 } },
                    ],
                    error: null,
                  }),
                }
              }),
            })),
            update,
            upsert,
          }
        }
        if (table === "social_analytics") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { social_post_id: "p1", likes: 12, comments: 1, shares: 0, impressions: 200, engagement_rate: 0.06 },
              ],
              error: null,
            }),
          }
        }
        if (table === "agent_tool_baselines") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert,
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)

    const result = await runSocialOutcomeTracker()

    expect(result.measured).toBe(2)
    expect(updates.map((u) => u.id)).toEqual(["m1", "m2"])
    for (const u of updates) {
      expect(u.patch.outcome_status).toBe("measured")
      expect(u.patch.impact_score).toBeTypeOf("number")
      const m = u.patch.outcome_metrics as { engagement_delta: number; post_count: number }
      expect(m.engagement_delta).toBeGreaterThan(0)
      expect(m.post_count).toBe(1) // legacy memo links one post
    }
    // With no baseline (n_measured < 5 warm-up), a positive delta scores +50.
    expect(updates[0].patch.impact_score).toBe(50)
    // Baseline refresh should fire once after the batch.
    expect(upsert).toHaveBeenCalled()
  })

  it("aggregates analytics across multiple posts when memo links to several platforms", async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
      eq: vi.fn().mockImplementation((_col: string, id: string) => {
        updates.push({ id, patch })
        return Promise.resolve({ data: null, error: null })
      }),
    }))
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    // Multi-platform memo: social_post_id null, three platforms in actions.
    const aged = [
      {
        id: "m-multi",
        social_post_id: null,
        actions: [
          { kind: "drafted_social_post", payload: { social_post_id: "p-li", platform: "linkedin" } },
          { kind: "drafted_social_post", payload: { social_post_id: "p-tt", platform: "tiktok" } },
          { kind: "drafted_social_post", payload: { social_post_id: "p-yt", platform: "youtube" } },
        ],
      },
    ]
    const inMock = vi.fn().mockResolvedValue({
      data: [
        { social_post_id: "p-li", likes: 5, comments: 1, shares: 0, impressions: 100, engagement_rate: 0.06 },
        { social_post_id: "p-tt", likes: 20, comments: 3, shares: 2, impressions: 400, engagement_rate: 0.07 },
        { social_post_id: "p-yt", likes: 8, comments: 0, shares: 1, impressions: 250, engagement_rate: 0.04 },
      ],
      error: null,
    })
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "outcome_status" && val === "pending") {
                  return { lt: vi.fn().mockResolvedValue({ data: aged, error: null }) }
                }
                return {
                  gte: vi.fn().mockResolvedValue({ data: [], error: null }),
                }
              }),
            })),
            update,
            upsert,
          }
        }
        if (table === "social_analytics") {
          return {
            select: vi.fn().mockReturnThis(),
            in: inMock,
          }
        }
        if (table === "agent_tool_baselines") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert,
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)

    const result = await runSocialOutcomeTracker()

    expect(result.measured).toBe(1)
    // Verify .in() was called with all three post ids.
    expect(inMock).toHaveBeenCalledWith("social_post_id", ["p-li", "p-tt", "p-yt"])
    expect(updates).toHaveLength(1)
    const m = updates[0].patch.outcome_metrics as {
      likes: number
      comments: number
      shares: number
      impressions: number
      post_count: number
      engagement_delta: number
    }
    expect(m.likes).toBe(5 + 20 + 8)
    expect(m.comments).toBe(1 + 3 + 0)
    expect(m.shares).toBe(0 + 2 + 1)
    expect(m.impressions).toBe(100 + 400 + 250)
    expect(m.post_count).toBe(3)
    expect(m.engagement_delta).toBeGreaterThan(0)
    expect(updates[0].patch.impact_score).toBe(50) // warm-up
  })

  it("skips memos with no linked posts", async () => {
    const update = vi.fn()
    const aged = [
      // no_eligible_topic memo — actions[0].kind is not drafted_social_post
      {
        id: "m-skip",
        social_post_id: null,
        actions: [{ kind: "no_eligible_topic", payload: { brief_id: "b1" } }],
      },
    ]
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "outcome_status" && val === "pending") {
                  return { lt: vi.fn().mockResolvedValue({ data: aged, error: null }) }
                }
                return {
                  gte: vi.fn().mockResolvedValue({ data: [], error: null }),
                }
              }),
            })),
            update,
            upsert: vi.fn(),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)

    const result = await runSocialOutcomeTracker()
    expect(result.measured).toBe(0)
    expect(result.skipped).toBe(1)
    expect(update).not.toHaveBeenCalled()
  })

  it("returns 0 measurements when no aged memos exist", async () => {
    const sb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "social_agent_memos") {
          return {
            select: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                lt: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
            update: vi.fn(),
            upsert: vi.fn(),
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }
    ;(getSupabase as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sb)
    const result = await runSocialOutcomeTracker()
    expect(result.measured).toBe(0)
  })
})
