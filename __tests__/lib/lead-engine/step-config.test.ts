// @vitest-environment node
import { describe, it, expect } from "vitest"
import { parseTagConfig, parseStageConfig } from "@/lib/lead-engine/step-config"

describe("parseTagConfig", () => {
  it("accepts a tag and returns it normalised", () => {
    expect(parseTagConfig({ tag: "  Warm   Lead " })).toEqual({ ok: true, value: { tag: "warm lead" } })
  })

  it("rejects a missing tag key", () => {
    const result = parseTagConfig({})
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain("tag")
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
})
