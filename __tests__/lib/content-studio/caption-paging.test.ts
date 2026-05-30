import { describe, it, expect } from "vitest"
import { pageCaptions, type TranscriptWord } from "@/lib/content-studio/caption-paging"

const w = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end })

describe("pageCaptions", () => {
  it("returns [] for empty input", () => {
    expect(pageCaptions([])).toEqual([])
  })

  it("puts a single word on one page with its own timing", () => {
    const pages = pageCaptions([w("go", 100, 400)])
    expect(pages).toHaveLength(1)
    expect(pages[0].text).toBe("go")
    expect(pages[0].startMs).toBe(100)
    expect(pages[0].endMs).toBe(400)
    expect(pages[0].words).toEqual([{ text: "go", startMs: 100, endMs: 400 }])
  })

  it("chunks into <=3-word pages by default (7 words -> 3/3/1)", () => {
    const words = [
      w("a", 0, 100), w("b", 100, 200), w("c", 200, 300),
      w("d", 300, 400), w("e", 400, 500), w("f", 500, 600),
      w("g", 600, 700),
    ]
    const pages = pageCaptions(words)
    expect(pages.map((p) => p.text)).toEqual(["a b c", "d e f", "g"])
    expect(pages[0].startMs).toBe(0)
    expect(pages[0].endMs).toBe(300)
    expect(pages[2].startMs).toBe(600)
    expect(pages[2].endMs).toBe(700)
  })

  it("honors a custom maxWordsPerPage", () => {
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 200, 300)]
    expect(pageCaptions(words, { maxWordsPerPage: 2 }).map((p) => p.text)).toEqual(["a b", "c"])
  })

  it("skips empty/whitespace words", () => {
    const pages = pageCaptions([w("a", 0, 100), w("  ", 100, 200), w("b", 200, 300)])
    expect(pages.map((p) => p.text)).toEqual(["a b"])
  })

  it("clamps a word whose end precedes its start", () => {
    const pages = pageCaptions([w("x", 500, 200)])
    expect(pages[0].startMs).toBe(500)
    expect(pages[0].endMs).toBe(500)
  })

  it("falls back to the default for a NaN/zero/negative maxWordsPerPage", () => {
    const words = [w("a", 0, 100), w("b", 100, 200), w("c", 200, 300), w("d", 300, 400)]
    // NaN, 0, and negative all fall back to the default of 3 (4 words -> 3 + 1)
    expect(pageCaptions(words, { maxWordsPerPage: NaN }).map((p) => p.text)).toEqual(["a b c", "d"])
    expect(pageCaptions(words, { maxWordsPerPage: 0 }).map((p) => p.text)).toEqual(["a b c", "d"])
    expect(pageCaptions(words, { maxWordsPerPage: -2 }).map((p) => p.text)).toEqual(["a b c", "d"])
  })
})
