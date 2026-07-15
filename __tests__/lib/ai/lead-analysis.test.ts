import { describe, it, expect, vi, beforeEach } from "vitest"

describe("generateLeadAnalysis", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("calls callAgent with MODEL_SONNET and returns its content", async () => {
    const mockCallAgent = vi.fn().mockResolvedValue({
      content: {
        priority: "high",
        priority_reason: "Clear goals, ready to book.",
        summary: "Logan is a baseball player looking for in-person coaching.",
        draft_reply: "Hi Logan, thanks for reaching out...",
      },
      tokens_used: 500,
    })
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: mockCallAgent,
      MODEL_SONNET: "sonnet",
    }))

    const { generateLeadAnalysis } = await import("@/lib/ai/lead-analysis")
    const result = await generateLeadAnalysis({
      name: "Logan Scalzo",
      serviceLabel: "In-Person Coaching",
      sport: "Baseball",
      experience: null,
      goals: "Get faster and stronger for next season",
      injuries: null,
      howHeard: null,
    })

    expect(result.content.priority).toBe("high")
    expect(mockCallAgent).toHaveBeenCalledTimes(1)
    const [systemPrompt, userMessage, , options] = mockCallAgent.mock.calls[0]
    expect(systemPrompt).toContain("Coach Darren")
    expect(userMessage).toContain("Logan Scalzo")
    expect(userMessage).toContain("Baseball")
    expect(options).toMatchObject({ model: "sonnet" })
  })

  it("omits optional fields from the prompt when absent", async () => {
    const mockCallAgent = vi.fn().mockResolvedValue({
      content: { priority: "low", priority_reason: "Vague ask.", summary: "Thin info.", draft_reply: "Hi..." },
      tokens_used: 300,
    })
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: mockCallAgent,
      MODEL_SONNET: "sonnet",
    }))

    const { generateLeadAnalysis } = await import("@/lib/ai/lead-analysis")
    await generateLeadAnalysis({
      name: "Jane Doe",
      serviceLabel: "Online Coaching",
      goals: "Just getting started",
    })

    const userMessage = mockCallAgent.mock.calls[0][1]
    expect(userMessage).not.toContain("Sport:")
    expect(userMessage).not.toContain("Injuries")
  })
})
