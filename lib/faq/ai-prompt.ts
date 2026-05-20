import { BUSINESS_INFO } from "@/lib/business-info"

interface BuildArgs {
  action: "generate_questions" | "suggest_answer"
  pageContext: string
  existingQuestions: string[]
  question?: string
}

/**
 * Build a grounded prompt for FAQ AI assist. The model may only use the
 * supplied page context and business facts — it must not invent claims.
 */
export function buildFaqAiPrompt(args: BuildArgs): string {
  const facts = `Business: ${BUSINESS_INFO.brand}. Location: ${BUSINESS_INFO.address.addressLocality}, ${BUSINESS_INFO.address.addressRegion}.`
  const existing = args.existingQuestions.length
    ? `Existing questions on this page (do NOT duplicate):\n${args.existingQuestions.map((q) => `- ${q}`).join("\n")}`
    : "This page has no FAQs yet."
  const rules =
    "Rules: answers must be accurate, concise and straightforward — no marketing fluff. Do NOT invent facts, statistics, names, prices, or claims that are not in the page context or business facts. If a fact is unknown, omit it."

  if (args.action === "suggest_answer") {
    return `You are drafting one FAQ answer for a sports performance coaching website.\n\n${facts}\n\nPage context: ${args.pageContext}\n\n${rules}\n\nWrite a single plain-text answer (40-90 words) to this question:\n"${args.question}"`
  }
  return `You are proposing FAQ questions for a page of a sports performance coaching website.\n\n${facts}\n\nPage context: ${args.pageContext}\n\n${existing}\n\n${rules}\n\nPropose 5 excellent, specific questions a real visitor to this page would ask. Return one question per line, no numbering.`
}
