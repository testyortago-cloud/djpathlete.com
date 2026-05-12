import { describe, expect, it } from "vitest"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"

describe("buildFaqPageSchema", () => {
  it("returns null when there are fewer than 3 entries (Google requires multiple Q&As)", () => {
    expect(buildFaqPageSchema([])).toBeNull()
    expect(buildFaqPageSchema([{ question: "Q1", answer: "A1" }])).toBeNull()
    expect(
      buildFaqPageSchema([
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ]),
    ).toBeNull()
  })

  it("returns a valid FAQPage schema for 3+ entries", () => {
    const schema = buildFaqPageSchema([
      { question: "How often should I deadlift?", answer: "Twice a week for most lifters." },
      { question: "Sumo or conventional?", answer: "Whichever lets you express the most force safely." },
      { question: "Belt or no belt?", answer: "Belt at 80%+ for working sets." },
    ])
    expect(schema).not.toBeNull()
    expect(schema!["@context"]).toBe("https://schema.org")
    expect(schema!["@type"]).toBe("FAQPage")
    const items = schema!.mainEntity
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      "@type": "Question",
      name: "How often should I deadlift?",
      acceptedAnswer: { "@type": "Answer", text: "Twice a week for most lifters." },
    })
  })

  it("skips entries with empty question or answer", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1", answer: "A1" },
      { question: "  ", answer: "A2" },
      { question: "Q3", answer: "" },
      { question: "Q4", answer: "A4" },
      { question: "Q5", answer: "A5" },
    ])
    expect(schema).not.toBeNull()
    expect(schema!.mainEntity).toHaveLength(3)
  })

  it("returns null for null/undefined input", () => {
    expect(buildFaqPageSchema(null)).toBeNull()
    expect(buildFaqPageSchema(undefined)).toBeNull()
  })
})
