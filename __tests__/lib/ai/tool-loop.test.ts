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

describe("the model actually receives what the tools returned", () => {
  // WHY THIS EXISTS. `create` is mocked, so nothing else in this file inspects
  // what the model was SENT — only what it returned. Two mutations proved the
  // gap: deleting the append that hands tool results back, and calling
  // executeTool but discarding its answer, both left the whole suite green.
  //
  // The stakes are not numeric. A fabricated PRICE would still be caught
  // downstream by the output validator; "yes, we run a goalkeeper track" would
  // not. With results never fed back, the assistant answers from model memory
  // and the turn records verdict:"ok" with no violation and no audit row.
  it("feeds the exact tool result back as a tool_result block", async () => {
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    const RESULT = '[{"name":"Rotational Reboot","priceCents":7900}]'
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        usage,
        content: [{ type: "tool_use", id: "t1", name: "list_programmes", input: {} }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "It is $79." }] })

    await runWithTools({
      system: "s",
      messages: [{ role: "user", content: "price?" }],
      tools: [],
      executeTool: async () => RESULT,
      model: "m",
      maxTokens: 100,
      maxToolRounds: 4,
    })

    expect(create).toHaveBeenCalledTimes(2)
    const secondCall = create.mock.calls[1][0] as {
      messages: Array<{ role: string; content: unknown }>
    }
    const toolResults = secondCall.messages.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>).filter((b) => b.type === "tool_result")
        : [],
    )
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ tool_use_id: "t1", content: RESULT })
  })

  it("tells the model a lookup FAILED, rather than handing it an empty string", async () => {
    // An empty tool result reads to a model as "found nothing", which is a
    // different and more dangerous answer than "could not look".
    const { runWithTools } = await import("@/lib/ai/tool-loop")
    create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        usage,
        content: [{ type: "tool_use", id: "t1", name: "boom", input: {} }],
      })
      .mockResolvedValueOnce({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "Sorry." }] })

    await runWithTools({
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

    const secondCall = create.mock.calls[1][0] as { messages: Array<{ content: unknown }> }
    const block = secondCall.messages
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : []))
      .find((b) => b.type === "tool_result") as { content: string; is_error?: boolean } | undefined

    expect(block?.is_error).toBe(true)
    expect(block?.content).toBeTruthy()
    expect(String(block?.content).length).toBeGreaterThan(10)
    // Never the thrown message — internal detail a model would read out.
    expect(String(block?.content)).not.toContain("db down")
  })
})
