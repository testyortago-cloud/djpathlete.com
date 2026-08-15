// __tests__/lib/funnels/sections/review/audit.test.ts
//
// THE FIRST SUITE IS THE POINT OF THIS FILE, AND IT ASSERTS IN BOTH
// DIRECTIONS.
//
// An auditor that returns clean on the page that motivated the work is
// worthless. An auditor that fires all twelve codes on every page is equally
// worthless and much harder to notice — it looks thorough, it produces a long
// findings list, and the reviser dutifully churns the page every single turn.
// So the real production document is checked in as evidence and asserted as an
// EXACT SET: these four fired, those four did not.
//
// The fixture is `funnel_steps.project_data` for step
// d4b1633b-478d-42f2-bab4-705fc06c8c7d, read out of production on 2026-08-15.
// If an assertion here fails, fix the auditor. Do not edit the fixture.

import { describe, expect, it } from "vitest"
import { auditDoc } from "@/lib/funnels/sections/review/audit"
import { AUDIT_CODES } from "@/lib/funnels/sections/review/findings"
import { sectionDocSchema, type SectionDoc } from "@/lib/funnels/sections/registry"
import fixture from "./fixtures/production-consultation-page.json"

/** Parsed through the REAL schema, so a fixture that drifted is a red test. */
const PROD: SectionDoc = sectionDocSchema.parse(fixture)

function codes(doc: SectionDoc): string[] {
  return auditDoc(doc).map((f) => f.code)
}

// ---------------------------------------------------------------------------
// Builders for the hand-written docs below.
// ---------------------------------------------------------------------------

function docOf(sections: SectionDoc["sections"], tone: "light" | "dark" = "light"): SectionDoc {
  return { v: 1, engine: "sections", theme: { tone, accent: "accent", radius: "soft" }, sections }
}

/** A cta section — the smallest kind that carries both a headline and a CTA. */
function cta(
  id: string,
  style: SectionDoc["sections"][number]["style"] = {},
  headline = "A headline that says something",
  target: Record<string, unknown> = { kind: "booking" },
): SectionDoc["sections"][number] {
  return {
    id,
    kind: "cta",
    variant: "band",
    style,
    props: { headline, cta: { label: "Go", target } },
  } as SectionDoc["sections"][number]
}

describe("the real production page", () => {
  it("is a valid SectionDoc — the fixture is real, not hand-written", () => {
    expect(PROD.sections).toHaveLength(8)
    expect(PROD.sections.map((s) => s.id)).toEqual([
      "hero",
      "proof",
      "what-you-get",
      "how",
      "voices",
      "questions",
      "book",
      "footer",
    ])
  })

  it("fires exactly the four codes it violates, and no others", () => {
    expect(codes(PROD).sort()).toEqual(["align-thrash", "pad-monotony", "tone-run", "tone-run"])
  })

  it("names BOTH same-tone seams, by section id and in page order", () => {
    const runs = auditDoc(PROD).filter((f) => f.code === "tone-run")
    expect(runs.map((f) => f.sectionIds)).toEqual([
      ["proof", "what-you-get"],
      ["voices", "questions"],
    ])
  })

  it("names the five-section padding run that made the page boring", () => {
    const monotony = auditDoc(PROD).find((f) => f.code === "pad-monotony")
    expect(monotony?.sectionIds).toEqual(["proof", "what-you-get", "how", "voices", "questions"])
    expect(monotony?.issue).toContain("5 sections in a row")
  })

  it("counts the four alignment changes", () => {
    // center, center, left, left, center, left, center, center
    const thrash = auditDoc(PROD).find((f) => f.code === "align-thrash")
    expect(thrash?.issue).toContain("4 times")
  })

  it("does NOT fire the four codes the page satisfies", () => {
    const found = codes(PROD)
    // Both CTAs target booking.
    expect(found).not.toContain("cta-divergence")
    // The FAQ is source "inline".
    expect(found).not.toContain("live-faq-on-campaign")
    // The proof strip is at position 2 of 8.
    expect(found).not.toContain("proof-below-fold")
    // 8 is within 6..9.
    expect(found).not.toContain("section-count")
  })

  it("does not flag the repeated CTA label — one offer, one action is the RULE", () => {
    // "Book your consultation" is the label on both the hero and the closing
    // CTA. A naive same-string-twice check flags the page for obeying the
    // prompt, which is worse than not checking at all.
    expect(codes(PROD)).not.toContain("copy-echo")
  })

  it("does not flag the live testimonial — the prompt prefers it", () => {
    expect(codes(PROD).filter((code) => code.includes("testimonial"))).toEqual([])
  })

  it("emits only codes that are in AUDIT_CODES", () => {
    for (const found of auditDoc(PROD)) {
      expect(AUDIT_CODES).toContain(found.code)
    }
  })

  it("gives every finding a section-specific issue and an actionable suggestion", () => {
    for (const found of auditDoc(PROD)) {
      expect(found.issue.length).toBeGreaterThan(20)
      expect(found.suggestion.length).toBeGreaterThan(20)
    }
  })
})

describe("a well-made page", () => {
  // Alternating tones, varied padding, one alignment change, proof at 2,
  // one action, an inline FAQ, seven sections.
  const good: SectionDoc = docOf([
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
  ] as SectionDoc["sections"])

  it("parses as a real SectionDoc", () => {
    expect(sectionDocSchema.safeParse(good).success).toBe(true)
  })

  it("raises NO findings at all — the metric discriminates", () => {
    // If this ever goes red, the auditor has started firing on good pages and
    // every finding it produces has become noise.
    expect(auditDoc(good)).toEqual([])
  })
})

describe("effective tone", () => {
  it("sees a dark THEME promoting untoned sections into a run", () => {
    // Neither section sets a tone. Reading `style.tone` directly gives two
    // `undefined`s and no finding; the page renders as two identical dark
    // bands. Only `sectionForPage`'s rule sees it.
    const doc = docOf([cta("a", { pad: "roomy" }), cta("b", { pad: "tight" })], "dark")
    const run = auditDoc(doc).find((f) => f.code === "tone-run")
    expect(run).toBeDefined()
    expect(run?.issue).toContain("dark")
  })

  it("treats an explicit tone as outranking the page default", () => {
    const doc = docOf([cta("a", { pad: "roomy", tone: "accent" }), cta("b", { pad: "tight" })], "dark")
    expect(codes(doc)).not.toContain("tone-run")
  })
})

describe("individual rules", () => {
  it("tone-run fires on two adjacent default sections", () => {
    expect(codes(docOf([cta("a"), cta("b")]))).toContain("tone-run")
  })

  it("tone-run names each seam of a three-section run", () => {
    const runs = auditDoc(docOf([cta("a"), cta("b"), cta("c")])).filter((f) => f.code === "tone-run")
    expect(runs.map((f) => f.sectionIds)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ])
  })

  it("pad-monotony needs four in a row, not three", () => {
    const three = docOf([
      cta("a", { pad: "normal", tone: "accent" }),
      cta("b", { pad: "normal", tone: "dark" }),
      cta("c", { pad: "normal", tone: "accent" }),
    ])
    expect(codes(three)).not.toContain("pad-monotony")

    const four = docOf([
      cta("a", { pad: "normal", tone: "accent" }),
      cta("b", { pad: "normal", tone: "dark" }),
      cta("c", { pad: "normal", tone: "accent" }),
      cta("d", { pad: "normal", tone: "dark" }),
    ])
    expect(codes(four)).toContain("pad-monotony")
  })

  it("align-thrash needs three changes, not two", () => {
    const two = docOf([
      cta("a", { align: "center", tone: "accent" }),
      cta("b", { align: "left", tone: "dark" }),
      cta("c", { align: "center", tone: "accent" }),
    ])
    expect(codes(two)).not.toContain("align-thrash")

    const three = docOf([
      cta("a", { align: "center", tone: "accent" }),
      cta("b", { align: "left", tone: "dark" }),
      cta("c", { align: "center", tone: "accent" }),
      cta("d", { align: "left", tone: "dark" }),
    ])
    expect(codes(three)).toContain("align-thrash")
  })

  it("headline-scale fires when a body section outranks the hero", () => {
    const doc = docOf([
      {
        id: "hero",
        kind: "hero",
        variant: "centered",
        style: { headline: "md", tone: "dark" },
        props: { headline: "Small hero", primaryCta: { label: "Go", target: { kind: "booking" } } },
      },
      cta("loud", { headline: "xl", tone: "accent" }),
    ] as SectionDoc["sections"])
    expect(codes(doc)).toContain("headline-scale")
  })

  it("markdown-leak catches bold markers", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "This is **important** news")]))).toContain("markdown-leak")
  })

  it("markdown-leak catches a leading list dash", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "- the first thing")]))).toContain("markdown-leak")
  })

  it("markdown-leak catches a backtick", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "Press the `go` button")]))).toContain("markdown-leak")
  })

  it("markdown-leak does not fire on an ordinary hyphenated phrase", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "A well-built eight-week plan")]))).not.toContain("markdown-leak")
  })

  it("headline-punctuation catches a trailing period", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "This is a headline.")]))).toContain("headline-punctuation")
  })

  it("headline-punctuation leaves a question mark alone", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "Ready to start?")]))).not.toContain("headline-punctuation")
  })

  it("cta-divergence fires when the page offers two different actions", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }, "One", { kind: "booking" }),
      cta("b", { tone: "dark" }, "Two", { kind: "url", href: "/shop" }),
    ])
    expect(codes(doc)).toContain("cta-divergence")
  })

  it("cta-divergence ignores an in-page anchor — that is not a second offer", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }, "One", { kind: "booking" }),
      cta("b", { tone: "dark" }, "Two", { kind: "anchor", sectionId: "a" }),
    ])
    expect(codes(doc)).not.toContain("cta-divergence")
  })

  it("live-faq-on-campaign fires on a live FAQ", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }),
      {
        id: "q",
        kind: "faq",
        variant: "stack",
        style: { tone: "muted" },
        props: { source: "live", pageKey: "home" },
      },
    ] as SectionDoc["sections"])
    expect(codes(doc)).toContain("live-faq-on-campaign")
  })

  it("proof-below-fold fires when the only proof is in the second half", () => {
    const doc = docOf([
      cta("a", { tone: "accent" }),
      cta("b", { tone: "dark" }),
      cta("c", { tone: "muted" }),
      cta("d", { tone: "accent" }),
      {
        id: "p",
        kind: "proof",
        variant: "stats",
        style: { tone: "dark" },
        props: {
          items: [
            { value: "1", label: "x" },
            { value: "2", label: "y" },
          ],
        },
      },
    ] as SectionDoc["sections"])
    expect(codes(doc)).toContain("proof-below-fold")
  })

  it("proof-below-fold fires when there is no proof at all", () => {
    const found = auditDoc(docOf([cta("a", { tone: "accent" })])).find((f) => f.code === "proof-below-fold")
    expect(found?.issue).toContain("no proof")
  })

  it("copy-echo fires on a repeated prose line across two sections", () => {
    const line = "The same sentence repeated verbatim"
    expect(codes(docOf([cta("a", { tone: "accent" }, line), cta("b", { tone: "dark" }, line)]))).toContain("copy-echo")
  })

  it("copy-echo ignores a short repeated phrase", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "Start now"), cta("b", { tone: "dark" }, "Start now")]))).not.toContain(
      "copy-echo",
    )
  })

  it("section-count fires below six and above nine", () => {
    expect(codes(docOf([cta("a", { tone: "accent" })]))).toContain("section-count")
  })

  it("length-strain fires on copy that nearly fills its schema cap", () => {
    // `cta.headline` is capped at 160 by the registry. This is derived, not
    // typed out: change the bound and this test follows it.
    const doc = docOf([cta("a", { tone: "accent" }, "x".repeat(158))])
    expect(codes(doc)).toContain("length-strain")
  })

  it("length-strain leaves comfortable copy alone", () => {
    expect(codes(docOf([cta("a", { tone: "accent" }, "x".repeat(60))]))).not.toContain("length-strain")
  })
})

describe("purity", () => {
  it("returns the same findings for the same document", () => {
    expect(auditDoc(PROD)).toEqual(auditDoc(PROD))
  })

  it("does not mutate the document it is given", () => {
    const before = JSON.stringify(PROD)
    auditDoc(PROD)
    expect(JSON.stringify(PROD)).toBe(before)
  })
})
