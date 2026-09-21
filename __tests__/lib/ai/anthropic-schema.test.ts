// Regression guard for the structured-outputs breakage: Anthropic's
// output_format endpoint rejects JSON schemas carrying minLength/maxLength/
// minimum/maximum/minItems/maxItems (every Zod .min()/.max() compiles to
// these — "For 'array' type, property 'maxItems' is not supported"), which
// killed strategist memos, ask-agent Q&A, and nightly ad recommendations.
// callAgent must force the provider's jsonTool mode (schema as a tool
// input_schema — the mechanism the functions/ runtime uses in production).
// THESE TEST THE ANTHROPIC FALLBACK PATH, DELIBERATELY.
//
// callAgent now prefers OpenRouter, and with OPENROUTER_API_KEY set it never
// reaches generateObject at all — the mock below would simply never fire, and
// every assertion here would pass vacuously or fail confusingly. Clearing the
// key selects the fallback, which is the path these assertions describe and
// which still runs whenever OpenRouter is unreachable.
//
// The equivalent guarantees on the PRIMARY path (image ordering, cache
// breakpoint placement, forced tool choice) are covered by
// __tests__/lib/ai/openrouter-request.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

const generateObjectMock = vi.fn()

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
  }
})

import { callAgent } from "@/lib/ai/anthropic"

beforeEach(() => {
  // Select the Anthropic fallback — see the note at the top of this file.
  delete process.env.OPENROUTER_API_KEY
  generateObjectMock.mockReset()
  generateObjectMock.mockResolvedValue({
    object: { answer: "ok" },
    usage: { inputTokens: 10, outputTokens: 5 },
    providerMetadata: {},
  })
})

describe("callAgent structured-output mode", () => {
  it("forces structuredOutputMode jsonTool so constraint-laden schemas never hit output_format", async () => {
    const schema = z.object({
      // Deliberately constraint-heavy — the shapes that 400 under output_format.
      items: z.array(z.string().min(1).max(30)).max(7),
      score: z.number().int().min(1).max(10),
      args: z.record(z.string(), z.unknown()),
    })

    await callAgent("system", "user", schema)

    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    const params = generateObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
      schema?: unknown
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
    // The original Zod schema still goes through so client-side validation
    // (and the model-visible constraints) are preserved.
    expect(params.schema).toBe(schema)
  })

  it("keeps jsonTool when the system prompt is cached", async () => {
    const schema = z.object({ answer: z.string().min(40).max(4000) })
    await callAgent("system", "user", schema, { cacheSystemPrompt: true })
    const params = generateObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
  })
})
