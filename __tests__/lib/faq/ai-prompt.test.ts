import { describe, it, expect } from "vitest"
import { buildFaqAiPrompt } from "@/lib/faq/ai-prompt"

describe("buildFaqAiPrompt", () => {
  it("includes the page context summary", () => {
    const p = buildFaqAiPrompt({
      action: "generate_questions",
      pageContext: "The online coaching page.",
      existingQuestions: [],
    })
    expect(p).toContain("The online coaching page.")
  })

  it("lists existing questions so the AI avoids duplicates", () => {
    const p = buildFaqAiPrompt({
      action: "generate_questions",
      pageContext: "ctx",
      existingQuestions: ["How much does it cost?"],
    })
    expect(p).toContain("How much does it cost?")
  })

  it("includes the target question for suggest_answer", () => {
    const p = buildFaqAiPrompt({
      action: "suggest_answer",
      pageContext: "ctx",
      existingQuestions: [],
      question: "What equipment do I need?",
    })
    expect(p).toContain("What equipment do I need?")
  })

  it("forbids inventing facts", () => {
    const p = buildFaqAiPrompt({ action: "generate_questions", pageContext: "ctx", existingQuestions: [] })
    expect(p.toLowerCase()).toContain("do not invent")
  })
})
