import { describe, it, expect } from "vitest"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"

describe("buildFaqPageSchema", () => {
  it("returns null below 3 entries", () => {
    expect(buildFaqPageSchema([{ question: "Q", answer: "A" }])).toBeNull()
  })

  it("returns null for empty/whitespace entries even if 3+", () => {
    expect(
      buildFaqPageSchema([
        { question: "  ", answer: "A" },
        { question: "Q", answer: "  " },
        { question: "", answer: "" },
      ]),
    ).toBeNull()
  })

  it("builds FAQPage JSON-LD for 3+ valid entries", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
      { question: "Q3", answer: "A3" },
    ])
    expect(schema?.["@type"]).toBe("FAQPage")
    expect(schema?.mainEntity).toHaveLength(3)
    expect(schema?.mainEntity[0]).toMatchObject({
      "@type": "Question",
      name: "Q1",
      acceptedAnswer: { "@type": "Answer", text: "A1" },
    })
  })
})
