import { describe, expect, it } from "vitest"
import { decisionSchema } from "../seo/decision-schema.js"

describe("decisionSchema", () => {
  const validQueueNewPost = {
    rank: 1 as const,
    tool: "queue_new_post" as const,
    args: { keyword: "deadlift form", angle: "biomechanics-first" },
  }
  const validQueueRefresh = {
    rank: 2 as const,
    tool: "queue_refresh" as const,
    args: { blog_post_id: "11111111-1111-1111-1111-111111111111", reason: "Lost 7 positions in 28d" },
    complementary_to_rank_1: "different type",
  }

  it("accepts a valid decision with two actions of different tools", () => {
    const valid = {
      rationale: "Striking-distance keyword + refresh of a decayed post — diverse and high-leverage.",
      actions: [validQueueNewPost, validQueueRefresh],
      brief_alignment_score: null,
      agent_confidence: 7,
      dissent_from_upstream: { dissents: false, reason: null },
    }
    const out = decisionSchema.safeParse(valid)
    expect(out.success).toBe(true)
  })

  it("rejects when actions.length != 2", () => {
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost],
        brief_alignment_score: null,
      }).success,
    ).toBe(false)
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost, validQueueRefresh, validQueueNewPost],
        brief_alignment_score: null,
      }).success,
    ).toBe(false)
  })

  it("rejects when both actions are the same tool", () => {
    const dup = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2 as const, tool: "queue_new_post" as const, args: { keyword: "x", angle: "y" } },
      ],
      brief_alignment_score: null,
    }
    expect(decisionSchema.safeParse(dup).success).toBe(false)
  })

  it("rejects an unknown tool name", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        { rank: 1, tool: "nuke_database", args: {} },
        validQueueRefresh,
      ],
      brief_alignment_score: null,
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects when rank is missing or not 1/2", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        { tool: "queue_new_post", args: { keyword: "x", angle: "y" } },
        validQueueRefresh,
      ],
      brief_alignment_score: null,
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("requires queue_refresh args.blog_post_id and args.reason", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2, tool: "queue_refresh", args: { blog_post_id: "id" } }, // missing reason
      ],
      brief_alignment_score: null,
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts flag_for_human with urgency enum", () => {
    const ok = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        {
          rank: 2,
          tool: "flag_for_human",
          args: { issue: "Possible cannibalization", urgency: "medium", context: "Posts X and Y both target keyword Z" },
        },
      ],
      brief_alignment_score: 8,
      agent_confidence: 7,
      dissent_from_upstream: { dissents: false, reason: null },
    }
    expect(decisionSchema.safeParse(ok).success).toBe(true)
  })

  it("rejects flag_for_human with invalid urgency", () => {
    const bad = {
      rationale: "x".repeat(50),
      actions: [
        validQueueNewPost,
        { rank: 2, tool: "flag_for_human", args: { issue: "x", urgency: "extreme", context: "y" } },
      ],
      brief_alignment_score: null,
    }
    expect(decisionSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects brief_alignment_score outside 1-10 range", () => {
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost, validQueueRefresh],
        brief_alignment_score: 0,
      }).success,
    ).toBe(false)
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost, validQueueRefresh],
        brief_alignment_score: 11,
      }).success,
    ).toBe(false)
  })

  it("requires brief_alignment_score field (null acceptable but not undefined)", () => {
    expect(
      decisionSchema.safeParse({
        rationale: "x".repeat(50),
        actions: [validQueueNewPost, validQueueRefresh],
      }).success,
    ).toBe(false)
  })

  it("requires agent_confidence and dissent_from_upstream", () => {
    const validBase = {
      rationale: "a".repeat(50),
      actions: [
        { rank: 1, tool: "flag_for_human", args: { issue: "test issue", urgency: "low", context: "context text" } },
        { rank: 2, tool: "queue_refresh", args: { blog_post_id: "00000000-0000-0000-0000-000000000001", reason: "stale" } },
      ],
      brief_alignment_score: null,
    }
    // Missing agent_confidence → should fail
    expect(() => decisionSchema.parse(validBase)).toThrow()

    // Adding both → should pass
    const withConfidence = {
      ...validBase,
      agent_confidence: 7,
      dissent_from_upstream: { dissents: false, reason: null },
    }
    expect(() => decisionSchema.parse(withConfidence)).not.toThrow()

    // Dissents=true without reason → should fail
    expect(() =>
      decisionSchema.parse({
        ...validBase,
        agent_confidence: 4,
        dissent_from_upstream: { dissents: true, reason: null },
      }),
    ).toThrow()
  })
})
