// @vitest-environment node
//
// THE LIVE LANE — can the page builder answer "make it green"?
//
// This is evidence ABOUT the model, in the same spirit as `chat-live.test.ts`,
// and it must never become a build gate: what a model writes on a given morning
// is not a property of this repo.
//
// It exists because the bug it covers is invisible to every mocked test. On
// 2026-09-08 the owner asked for "the background as the color green and the
// text in white" and got "I couldn't build that — try describing it
// differently", three turns running. Nothing was broken in any module: the
// prompt described `style.tone` as a rhythm knob and never said what colour any
// tone painted, so the model answered "I can't set literal colours — the
// document has no colour fields" and blocked the turn. A fixture cannot catch
// that, because a fixture is written by someone who already knows the answer.
//
// Run it with:
//   COLOUR_PROBE=1 npm run test:integration -- __tests__/integration/builder-colour-live.test.ts
//
// WRITES NOTHING: it calls the model directly with the real prompt, and never
// goes near the route, the draft or the database.
import { describe, it, expect } from "vitest"

import { streamAgent } from "@/lib/ai/anthropic"
import { recoverObjectFromError, recoverObjectFromValue } from "@/lib/ai/recover-object"
import { buildResultSchema, buildSystemPrompt, buildTurnMessage } from "@/lib/funnels/sections/prompt"
import { SECTION_BUILDER_EDIT_MAX_TOKENS, SECTION_BUILDER_MODEL } from "@/lib/funnels/sections/builder-config"
import type { SectionDoc } from "@/lib/funnels/sections/registry"

const RUN = process.env.COLOUR_PROBE === "1"

/**
 * The shape of the real page this failed on, reduced to what the question
 * needs: a tan (`accent`) band at the top, and a green (`dark`) one below it
 * that the owner can point at by name.
 */
const DOC: SectionDoc = {
  v: 1,
  engine: "sections",
  theme: { tone: "light", accent: "primary", radius: "soft" },
  sections: [
    {
      id: "apply",
      kind: "hero",
      variant: "simple",
      style: { pad: "roomy", tone: "accent", align: "left", headline: "xl" },
      props: { headline: "Cleared by your PT — but not ready to perform?", sub: "Discharge is a milestone." },
    },
    {
      id: "how",
      kind: "steps",
      variant: "numbered",
      style: { pad: "roomy", tone: "dark", align: "left", headline: "lg" },
      props: {
        heading: "How the readiness review works",
        steps: [
          { title: "You send the history", body: "Five minutes on the form." },
          { title: "Testing session", body: "One 90-minute on-site session." },
        ],
      },
    },
  ],
} as SectionDoc

async function runTurn(message: string) {
  const systemPrompt = buildSystemPrompt({
    catalogue: { program: [], session_pack: [], event: [] },
    faqPageKeys: [],
    stepSlugs: [],
    nextStepSlug: null,
  })
  const stream = streamAgent(systemPrompt, buildTurnMessage({ doc: DOC, history: [], message }), buildResultSchema, {
    model: SECTION_BUILDER_MODEL,
    maxTokens: SECTION_BUILDER_EDIT_MAX_TOKENS,
    cacheSystemPrompt: true,
  })
  // CLAIM THE REJECTION BEFORE DRAINING, like the route does. `stream.object`
  // can reject during the transform, and an unclaimed rejection surfaces as an
  // unhandled one — which reads as a bug in the model's answer rather than in
  // how this probe consumed it. It cost a confused run to learn that.
  const objectPromise = stream.object
  objectPromise.catch(() => {})

  let lastPartial: unknown = undefined
  try {
    for await (const part of stream.fullStream) {
      if (part.type === "object") lastPartial = (part as { object?: unknown }).object
    }
    return await objectPromise
  } catch (error) {
    const recovered =
      recoverObjectFromError(error, buildResultSchema) ?? recoverObjectFromValue(lastPartial, buildResultSchema)
    if (recovered === null) throw error
    return recovered
  }
}

describe.runIf(RUN)("the builder can be asked for a colour", () => {
  it("turns 'green with white text' into the tone that paints green", { timeout: 180_000 }, async () => {
    const result = await runTurn(
      "the section at the top 'cleared by your PT.....' i want the background as the color green and the text in white",
    )

    // The regression is a REFUSAL, so blocking is the thing to catch first.
    expect(result.blocked).toBe(false)
    const toned = result.ops.find((op) => op.op === "update_section" && op.id === "apply")
    expect(toned, `expected a tone change on "apply", got: ${JSON.stringify(result.ops)}`).toBeDefined()
    // `dark` is `background: var(--primary)` — the brand green. Asserting WHICH
    // tone, not merely that some style changed.
    expect((toned as { style?: { tone?: string } }).style?.tone).toBe("dark")
  })

  it("matches a tone the owner names by pointing at another section", { timeout: 180_000 }, async () => {
    const result = await runTurn("make the top section the same colour as the section 'how the readiness review works'")

    expect(result.blocked).toBe(false)
    const toned = result.ops.find((op) => op.op === "update_section" && op.id === "apply")
    expect((toned as { style?: { tone?: string } })?.style?.tone).toBe("dark")
  })
})
