import { describe, it, expect } from "vitest"
import { faqInputSchema } from "@/lib/validators/faq"

const valid = {
  page_key: "online",
  category: null,
  question: "How does online coaching work?",
  answer: "It is a remote, application-only program.",
  link_text: null,
  link_href: null,
  status: "published" as const,
}

describe("faqInputSchema", () => {
  it("accepts a valid FAQ", () => {
    expect(faqInputSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects an empty question", () => {
    expect(faqInputSchema.safeParse({ ...valid, question: "  " }).success).toBe(false)
  })

  it("rejects an empty answer", () => {
    expect(faqInputSchema.safeParse({ ...valid, answer: "" }).success).toBe(false)
  })

  it("rejects an unknown status", () => {
    expect(faqInputSchema.safeParse({ ...valid, status: "live" }).success).toBe(false)
  })

  it("rejects a half-set link (text without href)", () => {
    expect(faqInputSchema.safeParse({ ...valid, link_text: "Read more", link_href: null }).success).toBe(false)
  })

  it("accepts a fully-set link", () => {
    const r = faqInputSchema.safeParse({ ...valid, link_text: "Read more", link_href: "/about" })
    expect(r.success).toBe(true)
  })

  it("rejects an unknown page_key", () => {
    expect(faqInputSchema.safeParse({ ...valid, page_key: "nope" }).success).toBe(false)
  })

  it("accepts an event page_key", () => {
    expect(faqInputSchema.safeParse({ ...valid, page_key: "event/abc-123" }).success).toBe(true)
  })
})
