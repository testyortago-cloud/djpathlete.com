import { describe, it, expect } from "vitest"
import { aboutPageContentSchema } from "@/lib/validators/about-page"

const VALID = {
  hero_eyebrow: "Meet Your Coach",
  hero_heading: "About Darren J Paul",
  hero_credentials_line: "PhD · CSCS · NASM",
  hero_bio_paragraphs: ["A bio paragraph long enough to count."],
  aeo_eyebrow: "In short",
  aeo_question: "Who is Darren J Paul?",
  aeo_answer: "An answer.",
  story_heading: "The Journey",
  story_paragraphs: ["A story paragraph."],
  cta_eyebrow: "Ready?",
  cta_heading: "Ready to start training?",
  cta_description: "A description.",
  cta_button_label: "Get in Touch",
  cta_button_href: "/contact",
}

describe("aboutPageContentSchema", () => {
  it("accepts a fully populated valid object", () => {
    expect(aboutPageContentSchema.safeParse(VALID).success).toBe(true)
  })

  it("rejects an empty bio paragraphs array", () => {
    const result = aboutPageContentSchema.safeParse({ ...VALID, hero_bio_paragraphs: [] })
    expect(result.success).toBe(false)
  })

  it("rejects an empty story paragraphs array", () => {
    const result = aboutPageContentSchema.safeParse({ ...VALID, story_paragraphs: [] })
    expect(result.success).toBe(false)
  })

  it("rejects more than six bio paragraphs", () => {
    const result = aboutPageContentSchema.safeParse({
      ...VALID,
      hero_bio_paragraphs: Array.from({ length: 7 }, (_, i) => `paragraph ${i}`),
    })
    expect(result.success).toBe(false)
  })

  it("rejects a cta_button_href that is not a path or http(s) URL", () => {
    const result = aboutPageContentSchema.safeParse({
      ...VALID,
      cta_button_href: "javascript:alert(1)",
    })
    expect(result.success).toBe(false)
  })

  it("accepts an absolute https URL for cta_button_href", () => {
    const result = aboutPageContentSchema.safeParse({
      ...VALID,
      cta_button_href: "https://www.example.com/contact",
    })
    expect(result.success).toBe(true)
  })

  it("trims whitespace in scalar fields", () => {
    const result = aboutPageContentSchema.safeParse({
      ...VALID,
      hero_eyebrow: "  Meet Your Coach  ",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hero_eyebrow).toBe("Meet Your Coach")
    }
  })
})
