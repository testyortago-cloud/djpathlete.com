// @vitest-environment node
//
// The fixture in "the shape that actually happened" is not invented: it is the
// literal `text` of a response the live model returned on 2026-09-08 when the
// owner asked for a green background, captured by a probe against the real
// model. Three turns failed that way and the answer inside each was complete.
import { describe, it, expect } from "vitest"
import { z } from "zod"

import {
  describeModelError,
  recoverObjectFromError,
  recoverObjectFromValue,
  unwrapCandidates,
} from "@/lib/ai/recover-object"

const schema = z.object({
  reply: z.string().min(1),
  blocked: z.boolean().default(false),
  ops: z.array(z.object({ op: z.string() })),
})

/** The AI SDK's error chain, as it arrives at the caller. */
function noObjectError(text: string, value: unknown, issues: unknown[]) {
  const error = new Error("No object generated: response did not match schema.")
  error.name = "AI_NoObjectGeneratedError"
  Object.assign(error, {
    text,
    cause: {
      name: "AI_TypeValidationError",
      value,
      cause: { name: "ZodError", issues },
    },
  })
  return error
}

describe("the shape that actually happened", () => {
  const inner = '{"reply": "I can\'t set literal colours.", "blocked": true, "ops": []}'
  const text = JSON.stringify({ params: inner })

  it("recovers the model's object from a `params` string wrapper", () => {
    const error = noObjectError(text, { params: inner }, [
      { path: ["reply"], message: "Invalid input: expected string, received undefined" },
      { path: ["ops"], message: "Invalid input: expected array, received undefined" },
    ])

    const recovered = recoverObjectFromError(error, schema)

    // The whole point: the payload was never lost, only wrapped.
    expect(recovered).toEqual({ reply: "I can't set literal colours.", blocked: true, ops: [] })
  })

  it("reports the failing FIELDS, not just 'did not match schema'", () => {
    const error = noObjectError(text, { params: inner }, [
      { path: ["reply"], message: "Invalid input: expected string, received undefined" },
      { path: ["ops"], message: "Invalid input: expected array, received undefined" },
    ])

    const lines = describeModelError(error)

    // A retry told only the headline repeats itself — that is how one wrapped
    // response became two failed attempts and one "I couldn't build that".
    expect(lines).toContain("reply: Invalid input: expected string, received undefined")
    expect(lines).toContain("ops: Invalid input: expected array, received undefined")
  })
})

describe("recovery refuses what it cannot prove", () => {
  it("returns null when no candidate satisfies the caller's schema", () => {
    const error = noObjectError('{"params": "{\\"nonsense\\": 1}"}', { params: '{"nonsense": 1}' }, [])
    expect(recoverObjectFromError(error, schema)).toBeNull()
  })

  it("never strips a MULTI-key wrapper — that would be discarding data", () => {
    // `{a, b}` is a payload with two keys, not a wrapper around one of them.
    const candidates = unwrapCandidates({ a: '{"reply":"x","ops":[]}', b: 1 })
    expect(candidates).toEqual([{ a: '{"reply":"x","ops":[]}', b: 1 }])
  })

  it("does not throw on junk — the caller is already on a failure path", () => {
    expect(recoverObjectFromError(null, schema)).toBeNull()
    expect(recoverObjectFromError(new Error("boom"), schema)).toBeNull()
    expect(() => describeModelError(undefined)).not.toThrow()
  })

  it("terminates on a self-referential wrapper chain", () => {
    const loop: Record<string, unknown> = {}
    loop.only = loop
    expect(() => unwrapCandidates(loop)).not.toThrow()
    expect(unwrapCandidates(loop).length).toBeLessThanOrEqual(4)
  })
})

describe("both carriers are load-bearing, separately", () => {
  // Two sources satisfying one fixture is two guards masking each other:
  // remove either and the suite stays green while pinning neither. So each is
  // exercised with the OTHER absent.
  const inner = '{"reply": "ok", "blocked": false, "ops": []}'

  it("recovers when only `.text` carries the payload", () => {
    const error = Object.assign(new Error("No object generated: response did not match schema."), {
      name: "AI_NoObjectGeneratedError",
      text: JSON.stringify({ params: inner }),
      cause: { name: "AI_TypeValidationError", cause: { name: "ZodError", issues: [] } },
    })
    expect(recoverObjectFromError(error, schema)).toEqual({ reply: "ok", blocked: false, ops: [] })
  })

  it("recovers when only `.cause.value` carries the payload", () => {
    const error = Object.assign(new Error("No object generated: response did not match schema."), {
      name: "AI_NoObjectGeneratedError",
      cause: { name: "AI_TypeValidationError", value: { params: inner }, cause: { name: "ZodError", issues: [] } },
    })
    expect(recoverObjectFromError(error, schema)).toEqual({ reply: "ok", blocked: false, ops: [] })
  })
})

describe("the stream-transform failure shape", () => {
  // Measured against the live model on 2026-09-08: when the SDK rejects inside
  // the stream transform rather than at the final parse, what the caller
  // catches is a bare ZodError with NO `.text` and NO `.cause.value`. The last
  // partial object the stream emitted is then the only surviving copy.
  it("cannot be recovered from the error alone", () => {
    const bare = Object.assign(new Error("invalid"), { name: "ZodError", issues: [] })
    expect(recoverObjectFromError(bare, schema)).toBeNull()
  })

  it("IS recovered from the last partial object the stream emitted", () => {
    // The wrapper key is the model's invention and is not always `params` —
    // this one is the literal `"/"` a live run produced.
    const partial = { "/": '{"reply":"Switched to the brand green.","blocked":false,"ops":[{"op":"update_section"}]}' }
    expect(recoverObjectFromValue(partial, schema)).toEqual({
      reply: "Switched to the brand green.",
      blocked: false,
      ops: [{ op: "update_section" }],
    })
  })

  it("still refuses a partial that does not satisfy the schema", () => {
    // A stream cut off mid-write must NOT be salvaged into a half-page.
    expect(recoverObjectFromValue({ "/": '{"reply":"half' }, schema)).toBeNull()
  })
})

describe("an unwrapped response still works", () => {
  it("validates the outermost object when nothing was wrapped", () => {
    const good = { reply: "fine", blocked: false, ops: [{ op: "update_section" }] }
    const error = noObjectError(JSON.stringify(good), good, [])
    expect(recoverObjectFromError(error, schema)).toEqual(good)
  })
})
