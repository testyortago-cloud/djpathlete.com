import { describe, it, expect, vi } from "vitest"
import { fewShotsBlock, readFewShots } from "@/lib/agents/few-shots"

describe("lib/agents/few-shots — fewShotsBlock", () => {
  it("returns an empty string when given no examples", () => {
    expect(fewShotsBlock([])).toBe("")
  })

  it("renders the inspiration disclaimer and a numbered list", () => {
    const block = fewShotsBlock(["alpha", "bravo"])
    expect(block).toContain(
      "Recent winners (for inspiration only — do not copy verbatim):",
    )
    expect(block).toContain("  1. alpha")
    expect(block).toContain("  2. bravo")
  })

  it("caps the list at 3 entries", () => {
    const block = fewShotsBlock(["one", "two", "three", "four"])
    expect(block).toContain("three")
    expect(block).not.toContain("four")
  })

  it("truncates each example to 600 characters", () => {
    const big = "x".repeat(700)
    const block = fewShotsBlock([big])
    expect(block).toContain("x".repeat(600))
    expect(block).not.toContain("x".repeat(601))
  })
})

describe("lib/agents/few-shots — readFewShots", () => {
  function fakeSupabase(rowData: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: rowData, error })
    const eqCategory = vi.fn().mockReturnValue({ maybeSingle })
    const eqScope = vi.fn().mockReturnValue({ eq: eqCategory })
    const select = vi.fn().mockReturnValue({ eq: eqScope })
    const from = vi.fn(() => ({ select }))
    return { from } as never
  }

  it("returns [] when the row is missing", async () => {
    const supabase = fakeSupabase(null)
    expect(await readFewShots(supabase, "global", "ads_agent")).toEqual([])
  })

  it("returns [] when Supabase reports an error", async () => {
    const supabase = fakeSupabase(null, { message: "boom" })
    expect(await readFewShots(supabase, "global", "ads_agent")).toEqual([])
  })

  it("returns [] when the column is non-array", async () => {
    const supabase = fakeSupabase({ few_shot_examples: null })
    expect(await readFewShots(supabase, "global", "ads_agent")).toEqual([])
  })

  it("extracts string entries and { caption } entries together", async () => {
    const supabase = fakeSupabase({
      few_shot_examples: [
        "plain entry",
        { caption: "object entry", platform: "linkedin" },
        { not_a_caption: "ignored" },
        { caption: "" },
      ],
    })
    expect(await readFewShots(supabase, "global", "ads_agent")).toEqual([
      "plain entry",
      "object entry",
    ])
  })
})
