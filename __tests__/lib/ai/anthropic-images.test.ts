// The reference-image transport (2026-09-14 spec §3).
//
// THE CLAIM UNDER TEST IS THE ARGUMENT OBJECT, not that a call happened. The
// mutant this kills is an `images` option that is accepted and then dropped —
// which would leave the feature silently text-only with a green suite and a
// working UI.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

const generateObjectMock = vi.fn()
const streamObjectMock = vi.fn()

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
  }
})

import { callAgent, streamAgent } from "@/lib/ai/anthropic"

const schema = z.object({ answer: z.string() })
const IMAGE = { mediaType: "image/jpeg", data: "QUJD" }

beforeEach(() => {
  generateObjectMock.mockReset()
  streamObjectMock.mockReset()
  generateObjectMock.mockResolvedValue({
    object: { answer: "ok" },
    usage: { inputTokens: 10, outputTokens: 5 },
    providerMetadata: {},
  })
  streamObjectMock.mockReturnValue({ object: Promise.resolve({ answer: "ok" }), fullStream: (async function* () {})() })
})

describe("callAgent with an image", () => {
  it("sends a messages array with the text part and the image part, and NO prompt", async () => {
    await callAgent("system", "the owner's words", schema, { images: [IMAGE] })
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBeUndefined()
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "the owner's words" },
          { type: "image", image: "QUJD", mediaType: "image/jpeg" },
        ],
      },
    ])
  })

  it("is byte-identical to today's call when no image is passed", async () => {
    await callAgent("system", "the owner's words", schema)
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("the owner's words")
    expect(params.messages).toBeUndefined()
  })

  it("an EMPTY images array is treated as no image, not as an empty content list", async () => {
    // The mutant: `if (options?.images)` instead of a length check. An empty
    // array is truthy, and would send a user message with one text part in
    // `messages` form — a silent, permanent change of shape for every caller
    // that defaults the option to [].
    await callAgent("system", "hi", schema, { images: [] })
    const params = generateObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("hi")
    expect(params.messages).toBeUndefined()
  })

  it("keeps jsonTool and the cached system block when an image rides along", async () => {
    await callAgent("system", "hi", schema, { images: [IMAGE], cacheSystemPrompt: true })
    const params = generateObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
      system?: unknown
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
    expect(Array.isArray(params.system)).toBe(true)
  })

  it("puts the text part BEFORE the image part", async () => {
    // Deliberate (spec §3.2): the text part is the whole turn context and the
    // instruction "read the attached reference" must be in front of the model
    // before the attachment is.
    await callAgent("system", "hi", schema, { images: [IMAGE] })
    const params = generateObjectMock.mock.calls[0][0] as { messages: { content: { type: string }[] }[] }
    expect(params.messages[0].content.map((part) => part.type)).toEqual(["text", "image"])
  })
})

describe("streamAgent with an image", () => {
  it("sends a messages array with the text part and the image part, and NO prompt", () => {
    streamAgent("system", "the owner's words", schema, { images: [IMAGE] })
    const params = streamObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBeUndefined()
    expect(params.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "the owner's words" },
          { type: "image", image: "QUJD", mediaType: "image/jpeg" },
        ],
      },
    ])
  })

  it("is byte-identical to today's call when no image is passed", () => {
    streamAgent("system", "the owner's words", schema)
    const params = streamObjectMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.prompt).toBe("the owner's words")
    expect(params.messages).toBeUndefined()
  })

  it("keeps jsonTool when an image rides along", () => {
    streamAgent("system", "hi", schema, { images: [IMAGE] })
    const params = streamObjectMock.mock.calls[0][0] as {
      providerOptions?: { anthropic?: { structuredOutputMode?: string } }
    }
    expect(params.providerOptions?.anthropic?.structuredOutputMode).toBe("jsonTool")
  })
})
