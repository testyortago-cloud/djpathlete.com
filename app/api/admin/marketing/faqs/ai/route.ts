// app/api/admin/marketing/faqs/ai/route.ts
// AI assist for the FAQ editor: generate suggested questions for a page, or
// suggest an answer for one question. Admin-only. Non-streaming one-shot call.

import { NextResponse } from "next/server"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { resolveFaqPage } from "@/lib/faq/pages"
import { listFaqsForPage } from "@/lib/db/faqs"
import { buildFaqAiPrompt } from "@/lib/faq/ai-prompt"

const MODEL = "claude-sonnet-4-6"

const requestSchema = z
  .object({
    action: z.enum(["generate_questions", "suggest_answer"]),
    page_key: z.string().min(1),
    question: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.action !== "suggest_answer" || !!v.question, {
    message: "question is required for suggest_answer",
    path: ["question"],
  })

const EVENT_PAGE_CONTEXT =
  "An event page (camp or clinic) for DJP Athlete sports performance coaching."

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { action, page_key, question } = parsed.data

  // Resolve the page context.
  let pageContext: string
  const page = resolveFaqPage(page_key)
  if (page) {
    pageContext = page.contextSummary
  } else if (page_key.startsWith("event/")) {
    pageContext = EVENT_PAGE_CONTEXT
  } else {
    return NextResponse.json({ error: "Unknown page" }, { status: 400 })
  }

  const existing = await listFaqsForPage(page_key)
  const existingQuestions = existing.map((f) => f.question)

  const prompt = buildFaqAiPrompt({
    action,
    pageContext,
    existingQuestions,
    question,
  })

  let text: string
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text content in AI response")
    }
    text = textBlock.text
  } catch (error) {
    console.error("FAQ AI assist error:", error)
    return NextResponse.json(
      { error: "AI assist is unavailable right now." },
      { status: 502 },
    )
  }

  if (action === "generate_questions") {
    const questions = text
      .split("\n")
      .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim())
      .filter((line) => line.length > 0)
    return NextResponse.json({ questions })
  }

  return NextResponse.json({ answer: text.trim() })
}
