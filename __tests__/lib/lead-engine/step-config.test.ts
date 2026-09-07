// @vitest-environment node
import { describe, it, expect } from "vitest"
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"

/**
 * These `error` strings are not developer diagnostics. `decideStep` turns them
 * into `{ kind: "fail" }`, the runner writes them to
 * `sequence_runs.last_error`, and the contact detail page renders that raw
 * beside the run (components/admin/contacts/ContactDetail.tsx:239). So a coach
 * reads them, and they are held to the same plain-language bar as the timeline
 * copy Task 6 reworded.
 *
 * Every reject path is pinned to its exact sentence below rather than to a
 * `toContain("tag")`, which the previous version used: the new wording says
 * "tag" twice, so that assertion would have gone on passing for text nobody
 * could act on. The guard block at the end catches a FIFTH reason added later.
 */
const REJECTIONS = [
  parseTagConfig({}),
  parseTagConfig({ tag: "" }),
  parseStageConfig({}),
  parseStageConfig({ stage: "consulted", pipeline: "" }),
] as const

describe("parseTagConfig", () => {
  it("accepts a tag and returns it normalised", () => {
    expect(parseTagConfig({ tag: "  Warm   Lead " })).toEqual({ ok: true, value: { tag: "warm lead" } })
  })

  it("rejects a missing tag key, in words a coach can act on", () => {
    const result = parseTagConfig({})
    expect(result).toEqual({ ok: false, error: "This sequence's tag step does not say which tag to add." })
  })

  it("rejects an unusable tag with its own distinct sentence", () => {
    // A distinct message, not a shared one: "there is no tag" and "the tag you
    // gave cannot be stored" are different things to go and fix.
    const result = parseTagConfig({ tag: "x".repeat(41) })
    expect(result).toEqual({ ok: false, error: "This sequence's tag step names a tag that is blank or too long." })
  })

  it.each([
    ["a non-string", { tag: 42 }],
    ["an empty string", { tag: "" }],
    ["whitespace only", { tag: "   " }],
    ["over the length limit", { tag: "x".repeat(41) }],
  ])("rejects %s", (_label, config) => {
    expect(parseTagConfig(config as Record<string, unknown>).ok).toBe(false)
  })
})

describe("parseStageConfig", () => {
  it("accepts a stage and defaults the pipeline to null", () => {
    expect(parseStageConfig({ stage: "consulted" })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: null },
    })
  })

  it("accepts an explicit pipeline", () => {
    expect(parseStageConfig({ stage: "consulted", pipeline: "coaching" })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: "coaching" },
    })
  })

  it("trims surrounding whitespace on both keys", () => {
    expect(parseStageConfig({ stage: " consulted ", pipeline: " coaching " })).toEqual({
      ok: true,
      value: { stageKey: "consulted", pipelineKey: "coaching" },
    })
  })

  it.each([
    ["a missing stage key", {}],
    ["a non-string stage", { stage: 1 }],
    ["an empty stage", { stage: "  " }],
    ["a present but empty pipeline", { stage: "consulted", pipeline: "" }],
    ["a present but non-string pipeline", { stage: "consulted", pipeline: 7 }],
  ])("rejects %s", (_label, config) => {
    expect(parseStageConfig(config as Record<string, unknown>).ok).toBe(false)
  })

  it("says which of the two keys is wrong", () => {
    // The stage and the pipeline are different fields with different fixes, so
    // they must not share one message.
    expect(parseStageConfig({})).toEqual({
      ok: false,
      error: "This sequence's stage step does not say which stage to move the person to.",
    })
    expect(parseStageConfig({ stage: "consulted", pipeline: "" })).toEqual({
      ok: false,
      error: "This sequence's stage step does not say which pipeline to use.",
    })
  })
})

describe("every rejection is written for a coach, not a programmer", () => {
  // Task 6 reworded "board" out of the timeline copy because that word never
  // appears on screen — the Pipeline page says "pipeline", "card", "stages".
  // The same reader reaches these strings by a different route, so the same
  // bar applies. Backticks and "config" are programmer punctuation.
  it.each(REJECTIONS.map((r, i) => [i, r] as const))("rejection %i", (_i, result) => {
    // Presence control: a sentence-shaped assertion over an `ok: true` result
    // would vacuously pass.
    expect(result.ok).toBe(false)
    const error = (result as { ok: false; error: string }).error
    expect(error).not.toContain("`")
    expect(error.toLowerCase()).not.toContain("config")
    expect(error.toLowerCase()).not.toContain("board")
    // Still names WHICH step is at fault, and reads as a sentence.
    expect(error).toMatch(/(tag|stage) step/)
    expect(error.endsWith(".")).toBe(true)
  })
})
