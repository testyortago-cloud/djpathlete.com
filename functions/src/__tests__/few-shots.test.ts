import { describe, it, expect, vi } from "vitest"
import { fewShotsBlock, readFewShots } from "../lib/few-shots.js"

describe("fewShotsBlock", () => {
  it("returns an empty string when given no examples", () => {
    expect(fewShotsBlock([])).toBe("")
  })

  it("renders a numbered list of up to 3 examples with the inspiration disclaimer", () => {
    const block = fewShotsBlock(["alpha caption", "bravo caption"])
    expect(block).toContain(
      "Recent winners (for inspiration only — do not copy verbatim):",
    )
    expect(block).toContain("  1. alpha caption")
    expect(block).toContain("  2. bravo caption")
    // Trailing blank line so it concatenates cleanly with the next block.
    expect(block.endsWith("\n")).toBe(true)
  })

  it("caps the list at 3 entries and drops any beyond that", () => {
    const block = fewShotsBlock(["one", "two", "three", "four"])
    expect(block).toContain("  3. three")
    expect(block).not.toContain("four")
  })

  it("truncates each example to 600 characters", () => {
    const big = "x".repeat(700)
    const block = fewShotsBlock([big])
    // 600 chars + numbering prefix; should not contain the full 700.
    expect(block).toContain("x".repeat(600))
    expect(block).not.toContain("x".repeat(601))
  })
})

describe("readFewShots", () => {
  function fakeSupabase(rowData: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: rowData, error })
    const eqCategory = vi.fn().mockReturnValue({ maybeSingle })
    const eqScope = vi.fn().mockReturnValue({ eq: eqCategory })
    const select = vi.fn().mockReturnValue({ eq: eqScope })
    const from = vi.fn((_table: string) => ({ select }))
    return { from } as never
  }

  it("returns [] when the row is missing", async () => {
    const supabase = fakeSupabase(null)
    const out = await readFewShots(supabase, "global", "seo_agent")
    expect(out).toEqual([])
  })

  it("returns [] when Supabase reports an error", async () => {
    const supabase = fakeSupabase(null, { message: "boom" })
    const out = await readFewShots(supabase, "global", "seo_agent")
    expect(out).toEqual([])
  })

  it("returns [] when the column is non-array", async () => {
    const supabase = fakeSupabase({ few_shot_examples: null })
    const out = await readFewShots(supabase, "global", "seo_agent")
    expect(out).toEqual([])
  })

  it("extracts plain-string entries", async () => {
    const supabase = fakeSupabase({
      few_shot_examples: ["winner one", "winner two", ""],
    })
    const out = await readFewShots(supabase, "global", "seo_agent")
    expect(out).toEqual(["winner one", "winner two"])
  })

  it("extracts the caption field from object entries (social_caption shape)", async () => {
    const supabase = fakeSupabase({
      few_shot_examples: [
        { caption: "alpha", platform: "linkedin", engagement: 100 },
        { caption: "bravo" },
        { not_a_caption: "ignored" },
        { caption: "" },
      ],
    })
    const out = await readFewShots(supabase, "linkedin", "social_caption")
    expect(out).toEqual(["alpha", "bravo"])
  })

  it("mixes strings and objects without losing either", async () => {
    const supabase = fakeSupabase({
      few_shot_examples: ["plain", { caption: "obj" }],
    })
    const out = await readFewShots(supabase, "global", "chief_strategist")
    expect(out).toEqual(["plain", "obj"])
  })
})
