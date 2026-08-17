// __tests__/lib/funnels/sections/review/reviser.test.ts
//
// The reviser is the only part of the review that changes the page, so the
// assertions worth having are about what it CANNOT do: it cannot accept an op
// the builder would reject, and it cannot be given a description of the
// section registry that differs from the builder's.

import { describe, expect, it, vi, beforeEach } from "vitest"

const callAgent = vi.fn()
vi.mock("@/lib/ai/anthropic", () => ({
  callAgent: (...args: unknown[]) => callAgent(...args),
}))

import { clampSummary, REVISER_SYSTEM, reviseResultSchema, runReviser } from "@/lib/funnels/sections/review/reviser"
import { applyOps, opSchema } from "@/lib/funnels/sections/apply"
import {
  SECTION_BUILDER_MAX_OPS,
  SECTION_BUILDER_MODEL,
  SECTION_REVIEW_MAX_SUMMARY_LENGTH,
  SECTION_REVIEW_REVISER_MAX_TOKENS,
} from "@/lib/funnels/sections/builder-config"
import { SECTION_BUILDER_BLOCK_A } from "@/lib/funnels/sections/prompt"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"
import fixture from "./fixtures/production-consultation-page.json"

const PROD: SectionDoc = sectionDocSchema.parse(fixture) as SectionDoc

const FINDING: Finding = {
  code: "tone-run",
  severity: "high",
  sectionIds: ["proof", "what-you-get"],
  issue: "both render at the default tone",
  suggestion: "retone one of them",
  source: "audit",
}

beforeEach(() => {
  callAgent.mockReset()
})

describe("reviseResultSchema", () => {
  it("uses the REAL op grammar, so it accepts and rejects exactly what the builder does", () => {
    // Asserted as an AGREEMENT rather than against a hardcoded expectation:
    // the point is that there is one op grammar, not that any particular op
    // is legal. A second Zod copy would pass a test written the other way
    // right up until the two definitions diverged.
    const cases: unknown[] = [
      { op: "update_section", id: "hero", style: { tone: "muted" } },
      { op: "update_section", id: "hero" },
      { op: "remove_section", id: "hero" },
      { op: "move_section", id: "hero", after: null },
      { op: "set_theme", theme: { tone: "dark" } },
      { op: "not_an_op", id: "hero" },
      { op: "update_section" },
    ]
    for (const op of cases) {
      expect(reviseResultSchema.safeParse({ summary: "x", ops: [op] }).success).toBe(
        opSchema.safeParse(op).success,
      )
    }
  })

  it("lets a SCHEMA-valid op through that applyOps will still reject", () => {
    // An `update_section` carrying nothing is legal grammar and an illegal
    // EDIT — apply.ts enforces "at least one of props, style or variant"
    // semantically, and rejecting it there rejects every other op sent with
    // it, because the batch is transactional. So the schema is not the last
    // gate, and pipeline.ts must handle an ops batch that parses and then
    // fails to apply.
    const op = { op: "update_section", id: "hero" }
    expect(opSchema.safeParse(op).success).toBe(true)
    expect(applyOps(PROD, [op]).ok).toBe(false)
  })

  it("accepts an op the builder accepts", () => {
    const op = { op: "update_section", id: "hero", style: { tone: "muted" } }
    expect(opSchema.safeParse(op).success).toBe(true)
    expect(reviseResultSchema.safeParse({ summary: "Retoned the seam.", ops: [op] }).success).toBe(true)
  })

  it("bounds the batch at the builder's own op limit", () => {
    const ops = Array.from({ length: SECTION_BUILDER_MAX_OPS + 1 }, () => ({
      op: "update_section",
      id: "hero",
      style: { tone: "muted" },
    }))
    expect(reviseResultSchema.safeParse({ summary: "x", ops }).success).toBe(false)
  })

  it("NEVER rejects a summary for its length — the prose cannot cost the ops", () => {
    // THE REGRESSION. This is the production failure, reproduced at the exact
    // size that caused it: against a real stored page the reviser returned nine
    // valid ops with a 1,048-character summary, `summary` carried `.max(600)`,
    // and the single `too_big` issue made `generateObject` throw
    // `AI_NoObjectGeneratedError` — so all nine edits were discarded and the
    // owner was told "The reviewer could not finish."
    //
    // MUTANT: putting any `.max()` back on `summary`. It passes every other test
    // in this file, because every other summary here is three words long.
    const op = { op: "update_section", id: "hero", style: { tone: "muted" } }
    const long = "Retoned the seam between the proof and the offer. ".repeat(22)
    expect(long.length).toBeGreaterThan(1_000)

    const parsed = reviseResultSchema.safeParse({ summary: long, ops: [op] })
    expect(parsed.success).toBe(true)
    // And the ops are intact, which is the whole point of not rejecting.
    expect(parsed.success && parsed.data.ops).toHaveLength(1)
  })

  it("tolerates a missing summary rather than losing the ops with it", () => {
    // Same argument one step further: a model that returns ops and no prose at
    // all has still done the work. `clampSummary` supplies the sentence.
    const parsed = reviseResultSchema.safeParse({ ops: [] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.summary).toBe("")
  })

  it("accepts an empty ops array — 'the page is fine' is a valid answer", () => {
    expect(reviseResultSchema.safeParse({ summary: "Page reads well.", ops: [] }).success).toBe(true)
  })
})

describe("clampSummary", () => {
  it("leaves a summary that fits exactly as the model wrote it", () => {
    expect(clampSummary("  Retoned the seam.  ")).toBe("Retoned the seam.")
  })

  it("cuts an over-long summary to the last whole sentence that fits", () => {
    const long = "Retoned the seam between the proof and the offer. ".repeat(22)
    const clamped = clampSummary(long)
    expect(clamped.length).toBeLessThanOrEqual(SECTION_REVIEW_MAX_SUMMARY_LENGTH)
    // A full stop, not a severed word: this lands in the owner's transcript.
    expect(clamped.endsWith(".")).toBe(true)
    expect(long.startsWith(clamped)).toBe(true)
  })

  it("falls back to a word boundary when one sentence outruns the whole budget", () => {
    const clamped = clampSummary("word ".repeat(400))
    expect(clamped.length).toBeLessThanOrEqual(SECTION_REVIEW_MAX_SUMMARY_LENGTH)
    expect(clamped.endsWith("…")).toBe(true)
    expect(clamped).not.toMatch(/\s…$/)
  })

  it("never returns an empty string — appendTurn stores this as the turn's message", () => {
    // MUTANT: `return text` for the empty case. A blank summary would reach
    // `appendTurn` as the review turn's `message`, and the owner would get a
    // transcript row that says nothing about a page that changed.
    expect(clampSummary("")).not.toBe("")
    expect(clampSummary("   ")).not.toBe("")
  })
})

describe("the reviser prompt", () => {
  it("reuses the builder's frozen block rather than re-describing the registry", () => {
    // A second, shorter description of the ten kinds would age independently
    // of the generated one and start emitting ops for variants that no longer
    // exist — rejecting whole batches, silently.
    expect(REVISER_SYSTEM).toContain(SECTION_BUILDER_BLOCK_A)
  })

  it("does not mutate or re-derive the frozen block", () => {
    // prompt.ts pins Block A as reference-identical because interpolating into
    // it is a silent cache invalidator. Building REVISER_SYSTEM must not have
    // turned it into a function.
    const first = SECTION_BUILDER_BLOCK_A
    expect(SECTION_BUILDER_BLOCK_A).toBe(first)
  })

  it("puts the editor instructions AFTER the frozen block, not before", () => {
    // Before it, the cached prefix would no longer start at Block A.
    expect(REVISER_SYSTEM.indexOf(SECTION_BUILDER_BLOCK_A)).toBe(0)
  })

  it("tells the editor to prefer update_section over set_page", () => {
    // No `s` flag: the tsconfig target predates dotAll, and the instruction
    // is a single line anyway.
    expect(REVISER_SYSTEM).toMatch(/update_section.*over.*set_page/i)
  })

  it("permits an empty ops array explicitly", () => {
    expect(REVISER_SYSTEM).toMatch(/EMPTY\s+OPS ARRAY/i)
  })

  it("permits skipping a finding it disagrees with", () => {
    expect(REVISER_SYSTEM).toMatch(/disagree/i)
  })
})

describe("runReviser", () => {
  it("passes the findings to the model, with their suggestions", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(PROD, [FINDING])
    const message = callAgent.mock.calls[0][1] as string
    expect(message).toContain("both render at the default tone")
    expect(message).toContain("retone one of them")
    expect(message).toContain("proof, what-you-get")
  })

  it("sends the whole document, so ops can target ids it did not mention", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(PROD, [FINDING])
    expect(callAgent.mock.calls[0][1]).toContain('"questions"')
  })

  it("asks for the reviser budget and the builder's model", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(PROD, [])
    expect(callAgent.mock.calls[0][3]).toMatchObject({
      model: SECTION_BUILDER_MODEL,
      maxTokens: SECTION_REVIEW_REVISER_MAX_TOKENS,
    })
  })

  it("does not enable prompt caching on a system string with a live tail", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(PROD, [])
    expect(callAgent.mock.calls[0][3]).not.toMatchObject({ cacheSystemPrompt: true })
  })

  it("says plainly when there is nothing to fix", async () => {
    callAgent.mockResolvedValue({ content: { summary: "s", ops: [] }, usage: {} })
    await runReviser(PROD, [])
    expect(callAgent.mock.calls[0][1]).toContain("Return an empty ops array")
  })

  it("throws when the provider does — the pipeline needs to tell that apart from 'no change'", async () => {
    callAgent.mockRejectedValue(new Error("provider down"))
    await expect(runReviser(PROD, [FINDING])).rejects.toThrow("provider down")
  })
})

describe("ops the reviser produces reach the REAL applier", () => {
  it("a plausible retone applies cleanly to the production page", async () => {
    const ops = [
      { op: "update_section", id: "what-you-get", style: { tone: "muted" } },
      { op: "update_section", id: "questions", style: { tone: "muted" } },
    ]
    callAgent.mockResolvedValue({ content: { summary: "Retoned two seams.", ops }, usage: {} })

    const result = await runReviser(PROD, [FINDING])
    // Not a stub: `applyOps` is the same transactional applier the builder
    // uses, and it is the only thing that can say these ops are really valid.
    const applied = applyOps(PROD, result.ops)
    expect(applied.ok).toBe(true)
  })

  it("returns the ops and a clamped summary when the model overruns the transcript limit", async () => {
    // The end-to-end shape of the production failure: nine ops, a summary far
    // over the limit. What the caller gets back is nine ops and a shorter
    // sentence — not an exception.
    const ops = Array.from({ length: 9 }, () => ({ op: "update_section", id: "hero", style: { tone: "muted" } }))
    const long = "Retoned the seam between the proof and the offer. ".repeat(22)
    callAgent.mockResolvedValue({ content: { summary: long, ops }, usage: {} })

    const result = await runReviser(PROD, [FINDING])
    expect(result.ops).toHaveLength(9)
    expect(result.summary.length).toBeLessThanOrEqual(SECTION_REVIEW_MAX_SUMMARY_LENGTH)
    expect(result.summary.length).toBeGreaterThan(0)
  })

  it("an op naming a section that does not exist is rejected by the applier, not by us", async () => {
    const ops = [{ op: "update_section", id: "nope", style: { tone: "muted" } }]
    callAgent.mockResolvedValue({ content: { summary: "x", ops }, usage: {} })

    // Schema-valid — the id is a legal string — so only the applier catches it.
    const result = await runReviser(PROD, [FINDING])
    expect(reviseResultSchema.safeParse({ summary: "x", ops }).success).toBe(true)
    expect(applyOps(PROD, result.ops).ok).toBe(false)
  })
})
