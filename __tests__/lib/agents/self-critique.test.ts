import { describe, it, expect, vi, beforeEach } from "vitest"

describe("runSelfCritique", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns 'sound' when critique passes and does not trigger re-run", async () => {
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: { objections: [], overall: "sound" },
        tokens_used: 100,
      }),
      MODEL_HAIKU: "haiku",
    }))
    const { runSelfCritique, shouldReRunAfterCritique } = await import(
      "@/lib/agents/self-critique"
    )
    const result = await runSelfCritique({
      planSummary: "test plan",
      signalsSummary: "test signals",
      briefSummary: null,
    })
    expect(result.overall).toBe("sound")
    expect(result.objections).toHaveLength(0)
    expect(shouldReRunAfterCritique(result, 5)).toBe(false)
  })

  it("returns 'should_revise' with objections when critique objects", async () => {
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: vi.fn().mockResolvedValue({
        content: {
          objections: ["budget shift seems untested"],
          overall: "should_revise",
        },
        tokens_used: 120,
      }),
      MODEL_HAIKU: "haiku",
    }))
    const { runSelfCritique } = await import("@/lib/agents/self-critique")
    const result = await runSelfCritique({
      planSummary: "shift budget",
      signalsSummary: "weak signal",
      briefSummary: "brief here",
    })
    expect(result.overall).toBe("should_revise")
    expect(result.objections).toContain("budget shift seems untested")
  })

  it("shouldReRunAfterCritique only fires on should_revise AND confidence<=7", async () => {
    const { shouldReRunAfterCritique } = await import("@/lib/agents/self-critique")
    expect(
      shouldReRunAfterCritique({ overall: "should_revise", objections: ["x"] }, 7),
    ).toBe(true)
    expect(
      shouldReRunAfterCritique({ overall: "should_revise", objections: ["x"] }, 8),
    ).toBe(false)
    expect(
      shouldReRunAfterCritique({ overall: "minor_concern", objections: [] }, 4),
    ).toBe(false)
    expect(
      shouldReRunAfterCritique({ overall: "sound", objections: [] }, 1),
    ).toBe(false)
  })
})
