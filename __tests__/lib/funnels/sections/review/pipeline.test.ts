// __tests__/lib/funnels/sections/review/pipeline.test.ts
//
// THE CONTRACT PINNED HERE IS MOSTLY NEGATIVE.
//
// The review runs after the owner's page is already saved, so the interesting
// assertions are not "it improves the page" — they are that it never throws,
// never returns a document worse than the one it was handed, and never appends
// a turn it did not earn. A review that fails must be indistinguishable, from
// the owner's side, from a review that found nothing.
//
// The happy path is asserted end to end against the REAL production document
// and the REAL applyOps, so "it fixed the tone seam" means the seam is gone
// from a second, independent audit — not that a mock said so.

import { describe, expect, it, vi, beforeEach } from "vitest"

const runCritics = vi.fn()
const runReviser = vi.fn()

vi.mock("@/lib/funnels/sections/review/critics", () => ({
  runCritics: (...args: unknown[]) => runCritics(...args),
  CRITICS: [],
}))
vi.mock("@/lib/funnels/sections/review/reviser", () => ({
  runReviser: (...args: unknown[]) => runReviser(...args),
}))

import { reviewDoc, shouldReview } from "@/lib/funnels/sections/review/pipeline"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { Finding } from "@/lib/funnels/sections/review/findings"
import fixture from "./fixtures/production-consultation-page.json"

const PROD: SectionDoc = sectionDocSchema.parse(fixture)

// The production page's tones, in order:
//   hero dark | proof — | what-you-get — | how muted | voices — | questions — |
//   book accent | footer —          ("—" meaning no tone set, i.e. default)
// The two seams are proof/what-you-get and voices/questions.

/**
 * Ops that genuinely clear BOTH seams.
 *
 * Chosen with the neighbours in mind: `proof` -> muted sits between a dark
 * hero and a default `what-you-get`, and `questions` -> muted sits between a
 * default `voices` and an accent `book`. Result: dark, muted, default, muted,
 * default, muted, accent, default — no two neighbours alike.
 */
const RETONE_OPS = [
  { op: "update_section", id: "proof", style: { tone: "muted" } },
  { op: "update_section", id: "questions", style: { tone: "muted" } },
]

/**
 * Ops that look like a fix and are not.
 *
 * Retoning `what-you-get` to muted closes the proof/what-you-get seam and
 * opens a new one against `how`, which is ALREADY muted. This was the first
 * thing written in this file and the gate caught it — which is the entire
 * reason the gate exists, so it stays as a test rather than being quietly
 * corrected out of history.
 */
const SEAM_SHUFFLING_OPS = [
  { op: "update_section", id: "what-you-get", style: { tone: "muted" } },
  { op: "update_section", id: "questions", style: { tone: "muted" } },
]

const CRITIC_FINDING: Finding = {
  code: "vague-headline",
  severity: "medium",
  sectionIds: ["hero"],
  issue: "the headline could describe any coach",
  suggestion: "name the sport and the timeframe",
  source: "copy",
}

beforeEach(() => {
  runCritics.mockReset()
  runReviser.mockReset()
})

describe("shouldReview", () => {
  it("runs on a first draft — every word is the model's own", () => {
    expect(shouldReview({ isRewrite: true, requested: false })).toBe(true)
  })

  it("does not run on an ordinary edit turn", () => {
    // The owner just said exactly what they wanted. A reviewer that
    // second-guesses that every turn is one they will switch off.
    expect(shouldReview({ isRewrite: false, requested: false })).toBe(false)
  })

  it("runs on an ordinary turn when the owner pressed Polish", () => {
    expect(shouldReview({ isRewrite: false, requested: true })).toBe(true)
  })
})

describe("the happy path, end to end", () => {
  it("clears the real page's tone seams, proven by a second audit", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "Retoned two seams.", ops: RETONE_OPS })

    const out = await reviewDoc({ doc: PROD })

    expect(out.error).toBeNull()
    expect(out.changed).toBe(true)
    // Before: two seams. After: none. Measured by the auditor, not asserted.
    expect(out.findings.filter((f) => f.code === "tone-run")).toHaveLength(2)
    expect(out.surviving.filter((f) => f.code === "tone-run")).toEqual([])
    // And the returned document really is the changed one.
    expect(auditDoc(out.doc).filter((f) => f.code === "tone-run")).toEqual([])
  })

  it("REPORTS a fix that only moved the problem, instead of calling it done", async () => {
    // The gate's whole justification. These ops close one seam and open
    // another; without the re-audit the turn would report two seams fixed and
    // ship a page with one still in it.
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "Retoned two seams.", ops: SEAM_SHUFFLING_OPS })

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(true)
    const stillThere = out.surviving.filter((f) => f.code === "tone-run")
    expect(stillThere).toHaveLength(1)
    expect(stillThere[0].sectionIds).toEqual(["what-you-get", "how"])
  })

  it("returns the receipt from the real applier, not the model's claim", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: RETONE_OPS })
    const out = await reviewDoc({ doc: PROD })
    expect(out.receipt).not.toBeNull()
    expect(out.receipt?.isRewrite).toBe(false)
  })

  it("merges critic findings in with the deterministic ones", async () => {
    runCritics.mockResolvedValue([CRITIC_FINDING])
    runReviser.mockResolvedValue({ summary: "s", ops: RETONE_OPS })
    const out = await reviewDoc({ doc: PROD })
    expect(out.findings.map((f) => f.code)).toContain("vague-headline")
    expect(out.findings.map((f) => f.code)).toContain("tone-run")
  })

  it("hands the reviser the merged list, high severity first", async () => {
    runCritics.mockResolvedValue([CRITIC_FINDING])
    runReviser.mockResolvedValue({ summary: "s", ops: RETONE_OPS })
    await reviewDoc({ doc: PROD })
    const passed = runReviser.mock.calls[0][1] as Finding[]
    expect(passed[0].severity).toBe("high")
  })
})

describe("failure containment", () => {
  it("returns the page UNCHANGED, by reference, when the reviser throws", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockRejectedValue(new Error("model down"))

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
    expect(out.error).toContain("model down")
  })

  it("returns the page UNCHANGED when applyOps rejects the batch", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [{ op: "remove_section", id: "does-not-exist" }] })

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
    expect(out.error).toContain("ops rejected")
  })

  it("returns the page UNCHANGED on a schema-valid op the applier refuses", async () => {
    // `opSchema` accepts an update_section carrying nothing; applyOps does
    // not, and it takes the whole batch down with it.
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [{ op: "update_section", id: "hero" }] })

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(false)
    expect(out.doc).toBe(PROD)
  })

  it("still reviews from deterministic findings alone when the panel dies", async () => {
    runCritics.mockRejectedValue(new Error("all three failed"))
    runReviser.mockResolvedValue({ summary: "s", ops: RETONE_OPS })

    const out = await reviewDoc({ doc: PROD })

    expect(runReviser).toHaveBeenCalled()
    const passed = runReviser.mock.calls[0][1] as Finding[]
    expect(passed.some((f) => f.code === "tone-run")).toBe(true)
    expect(out.changed).toBe(true)
  })

  it("never throws, whatever fails", async () => {
    runCritics.mockRejectedValue(new Error("boom"))
    runReviser.mockRejectedValue(new Error("boom"))
    await expect(reviewDoc({ doc: PROD })).resolves.toBeDefined()
  })

  it("degrades to the deterministic findings when the panel returns garbage", async () => {
    // Not merely "does not throw": a malformed panel result must cost the
    // CRITIC findings only. The deterministic pass had already succeeded and
    // cost nothing, and losing it would abandon a review that was working.
    runCritics.mockResolvedValue(undefined)
    runReviser.mockResolvedValue({ summary: "s", ops: RETONE_OPS })

    const out = await reviewDoc({ doc: PROD })

    expect(out.error).toBeNull()
    expect(out.changed).toBe(true)
    expect(out.findings.some((f) => f.code === "tone-run")).toBe(true)
  })
})

describe("restraint", () => {
  it("appends nothing when the reviser judges the page fine", async () => {
    // An empty ops array is a GOOD outcome. Treating it as a change would give
    // every page an empty "I changed nothing" turn in its transcript.
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "The page reads well.", ops: [] })

    const out = await reviewDoc({ doc: PROD })

    expect(out.changed).toBe(false)
    expect(out.error).toBeNull()
    expect(out.summary).toBe("The page reads well.")
  })

  it("does not call the reviser at all when nothing was found", async () => {
    const clean: SectionDoc = sectionDocSchema.parse({
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [
        {
          id: "hero",
          kind: "hero",
          variant: "centered",
          style: { headline: "xl", align: "center", tone: "dark", pad: "roomy" },
          props: {
            headline: "Rebuild your sprint speed in eight weeks",
            primaryCta: { label: "Start now", target: { kind: "booking" } },
          },
        },
        {
          id: "proof",
          kind: "proof",
          variant: "stats",
          style: { align: "center", pad: "tight" },
          props: {
            items: [
              { value: "500+", label: "athletes trained" },
              { value: "12 yrs", label: "coaching" },
            ],
          },
        },
        {
          id: "what",
          kind: "bullets",
          variant: "cards",
          style: { headline: "lg", align: "center", tone: "muted", pad: "roomy" },
          props: { heading: "What you get", items: [{ title: "Assessment" }, { title: "Programming" }] },
        },
        {
          id: "how",
          kind: "steps",
          variant: "numbered",
          style: { headline: "lg", align: "center", pad: "normal" },
          props: { heading: "How it works", steps: [{ title: "Assess" }, { title: "Build" }] },
        },
        {
          id: "faq",
          kind: "faq",
          variant: "stack",
          style: { headline: "lg", align: "center", tone: "muted", pad: "normal" },
          props: { heading: "Questions", source: "inline", items: [{ q: "What does it cost?", a: "Free." }] },
        },
        {
          id: "book",
          kind: "cta",
          variant: "band",
          style: { headline: "lg", align: "center", tone: "accent", pad: "roomy" },
          props: { headline: "Start this week", cta: { label: "Start now", target: { kind: "booking" } } },
        },
        {
          id: "footer",
          kind: "footer",
          variant: "simple",
          style: { align: "center", pad: "tight" },
          props: { businessName: "DJP Athlete", lines: [], links: [] },
        },
      ],
    })

    runCritics.mockResolvedValue([])
    const out = await reviewDoc({ doc: clean })

    expect(out.changed).toBe(false)
    expect(out.error).toBeNull()
    expect(runReviser).not.toHaveBeenCalled()
  })
})

describe("streaming", () => {
  it("emits each deterministic finding as it lands", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [] })

    const seen: string[] = []
    await reviewDoc({ doc: PROD, onFinding: (finding) => seen.push(finding.code) })

    expect(seen).toContain("tone-run")
    expect(seen).toContain("pad-monotony")
  })

  it("emits critic findings too", async () => {
    runCritics.mockResolvedValue([CRITIC_FINDING])
    runReviser.mockResolvedValue({ summary: "s", ops: [] })

    const seen: string[] = []
    await reviewDoc({ doc: PROD, onFinding: (finding) => seen.push(finding.code) })

    expect(seen).toContain("vague-headline")
  })

  it("does not require an onFinding callback", async () => {
    runCritics.mockResolvedValue([])
    runReviser.mockResolvedValue({ summary: "s", ops: [] })
    await expect(reviewDoc({ doc: PROD })).resolves.toBeDefined()
  })
})
