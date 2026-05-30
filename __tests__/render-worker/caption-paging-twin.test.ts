// Guards the twin-file obligation: render-worker/src/lib/caption-paging.ts is a
// hand-maintained copy of lib/content-studio/caption-paging.ts (the worker
// package cannot import the parent lib/ — see CLAUDE.md). If someone edits one
// copy's logic and forgets the other, this test fails. It compares behavior
// (output over a battery of inputs), not source text, so harmless formatting or
// comment differences don't trip it.
import { describe, it, expect } from "vitest"
import { pageCaptions as canonical, type TranscriptWord } from "@/lib/content-studio/caption-paging"
import { pageCaptions as twin } from "@/render-worker/src/lib/caption-paging"

const CASES: { words: TranscriptWord[]; opts?: { maxWordsPerPage?: number } }[] = [
  { words: [] },
  { words: [{ text: "go", start: 100, end: 400 }] },
  {
    words: [
      { text: "a", start: 0, end: 100 },
      { text: "b", start: 100, end: 200 },
      { text: "c", start: 200, end: 300 },
      { text: "d", start: 300, end: 400 },
      { text: "e", start: 400, end: 500 },
      { text: "f", start: 500, end: 600 },
      { text: "g", start: 600, end: 700 },
    ],
  },
  { words: [{ text: "a", start: 0, end: 100 }, { text: "b", start: 100, end: 200 }, { text: "c", start: 200, end: 300 }], opts: { maxWordsPerPage: 2 } },
  { words: [{ text: "a", start: 0, end: 100 }, { text: "  ", start: 100, end: 200 }, { text: "b", start: 200, end: 300 }] },
  { words: [{ text: "x", start: 500, end: 200 }] },
  { words: [{ text: "a", start: 0, end: 100 }, { text: "b", start: 100, end: 200 }], opts: { maxWordsPerPage: NaN } },
  { words: [{ text: "a", start: 0, end: 100 }, { text: "b", start: 100, end: 200 }], opts: { maxWordsPerPage: -3 } },
]

describe("caption-paging twin parity", () => {
  it("worker twin produces identical output to the canonical for every case", () => {
    for (const c of CASES) {
      expect(twin(c.words, c.opts)).toEqual(canonical(c.words, c.opts))
    }
  })
})
