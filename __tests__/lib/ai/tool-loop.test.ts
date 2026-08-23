// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const create = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create }
  },
}))

beforeEach(() => {
  create.mockReset()
})

const usage = { input_tokens: 10, output_tokens: 5 }

describe("runWithTools", () => {
  it("returns the text when the model calls no tool", async () => {
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    create.mockResolvedValueOnce({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "Hello." }] })
    const r = await runWithTools({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      executeTool: async () => "",
      model: "m",
      maxTokens: 100,
      maxToolRounds: 4,
    })
    expect(r.text).toBe("Hello.")
    expect(r.toolCalls).toEqual([])
  })

  it("executes a tool and feeds the result back", async () => {
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        usage,
        content: [{ type: "tool_use", id: "t1", name: "list_programmes", input: {} }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "It is $79." }] })
    const executeTool = vi.fn().mockResolvedValue('[{"name":"Rotational Reboot"}]')
    const r = await runWithTools({
      system: "s",
      messages: [{ role: "user", content: "price?" }],
      tools: [],
      executeTool,
      model: "m",
      maxTokens: 100,
      maxToolRounds: 4,
    })
    expect(executeTool).toHaveBeenCalledWith("list_programmes", {})
    expect(r.text).toBe("It is $79.")
    expect(r.toolCalls).toEqual([{ name: "list_programmes", input: {} }])
    expect(r.tokensInput).toBe(20)
  })

  it("stops at maxToolRounds and says so, rather than looping forever", async () => {
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    create.mockResolvedValue({
      stop_reason: "tool_use",
      usage,
      content: [{ type: "tool_use", id: "t", name: "search_faqs", input: { query: "x" } }],
    })
    const r = await runWithTools({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      executeTool: async () => "[]",
      model: "m",
      maxTokens: 100,
      maxToolRounds: 2,
    })
    expect(create).toHaveBeenCalledTimes(2)
    expect(r.stoppedOnRoundLimit).toBe(true)
  })

  it("surfaces a tool that throws as a tool result, not as a crashed turn", async () => {
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        usage,
        content: [{ type: "tool_use", id: "t1", name: "boom", input: {} }],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        usage,
        content: [{ type: "text", text: "I could not look that up." }],
      })
    const r = await runWithTools({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      executeTool: async () => {
        throw new Error("db down")
      },
      model: "m",
      maxTokens: 100,
      maxToolRounds: 4,
    })
    expect(r.text).toBe("I could not look that up.")
  })
})
