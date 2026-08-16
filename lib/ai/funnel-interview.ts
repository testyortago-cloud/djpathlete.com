// lib/ai/funnel-interview.ts — turning a sentence into a funnel plan.
//
// Two calls, no conversation state, no stored transcript:
//
//   1. `interviewQuestions(brief)`  — Haiku. Cheap and interactive; asking
//      three good questions about a sentence is not the hard part.
//   2. `draftFunnelPlan(brief, answers)` — Sonnet. Choosing the template,
//      naming the steps and writing the brief IS the hard part, and it is the
//      output the owner reviews.
//
// The same split the strategy agents use for critique vs reason. Both go
// through `callAgent`, which owns the retry and the `jsonTool` workaround for
// schemas carrying `.min()`/`.max()` — there is no new AI plumbing here.
//
// NEITHER PROMPT RESTATES THE TEMPLATE RULES. The template list in the system
// prompt is GENERATED from `FUNNEL_TEMPLATES`, so a template added to the
// registry is offered to the model on the next call with no edit here. And the
// plan's own template field is a Zod enum derived from the same const, so the
// model is constrained by the registry twice over — once by what it is told,
// once by what it is allowed to return. `sanitiseFunnelPlan` is the third pass
// and the one that assumes nothing.

import { z } from "zod"
import { callAgent } from "@/lib/ai/anthropic"
import { MODEL_HAIKU, MODEL_SONNET } from "@/lib/ai/models"
import { FUNNEL_TEMPLATES, MAX_FUNNEL_STEPS } from "@/lib/funnels/templates"
import { FUNNEL_GOALS } from "@/lib/validators/funnel"
import type { RawFunnelPlan } from "@/lib/funnels/ai-plan"

/** How many questions we ask. Few enough to answer in one sitting. */
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 5

export const BRIEF_MAX_LENGTH = 600
export const ANSWER_MAX_LENGTH = 600

const questionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(160),
  /** One line under the field. Never a second question. */
  hint: z.string().max(160).nullable(),
  placeholder: z.string().max(80).nullable(),
})

const questionsSchema = z.object({
  questions: z.array(questionSchema).min(MIN_QUESTIONS).max(MAX_QUESTIONS),
})

export type InterviewQuestion = z.infer<typeof questionSchema>

/** Which thing is being created. A page is not a one-step funnel. */
export type CreateKind = "page" | "funnel"

/**
 * The template vocabulary the model may return, DERIVED from the registry for
 * the same reason `createFunnelSchema`'s is: a hand-typed list here would let
 * the model pick something the dialog cannot render, and the failure would look
 * like the AI "not working" rather than like a stale copy.
 */
const templateEnum = z.enum(
  FUNNEL_TEMPLATES.map((template) => template.value) as [string, ...string[]],
)

const planSchema = z.object({
  template: templateEnum,
  name: z.string().min(1).max(120),
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        slug: z.string().max(80),
        goal: z.string().nullable(),
      }),
    )
    .min(1)
    .max(MAX_FUNNEL_STEPS),
  audience: z.string().max(300).nullable(),
  description: z.string().max(500).nullable(),
  offer: z
    .object({ kind: z.enum(["program", "session_pack", "event"]), ref: z.string().max(120) })
    .nullable(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
})

/** The registry, rendered for the prompt. Generated, never hand-listed. */
function templateCatalogue(): string {
  return FUNNEL_TEMPLATES.map((template) => {
    const steps = template.steps.map((step) => `${step.name} (${step.slug})`).join(" -> ")
    return `- ${template.value}: ${template.label} — ${template.hint}. Steps: ${steps}. Asks for: ${template.asks.join(", ")}.`
  }).join("\n")
}

const FUNNEL_QUESTIONS_SYSTEM = `You help a strength-and-conditioning coach set up a marketing funnel. Given one sentence about what they want to build, ask the ${MIN_QUESTIONS}-${MAX_QUESTIONS} questions whose answers would most change the finished pages.

Ask about things only they can know — who it is for, what is being sold and at what price, dates, what happens after signup, what makes their offer different. NEVER ask which template to use, what the URL should be, or anything about page layout: the system decides those.

Each question is one short sentence, answerable in a line or two. No compound questions. Give a hint only when the question would otherwise be ambiguous, and a placeholder only when an example answer genuinely helps.

Return only the questions.`

function planSystem(): string {
  return `You turn a coach's brief and their answers into a funnel plan.

Choose ONE template from this list and use its step plan as your starting point:
${templateCatalogue()}

Rules:
- Pick the template that matches what they described. If nothing fits, use "scratch".
- Keep the template's steps unless the answers clearly call for one more or one fewer. Rename steps to the coach's own words where that reads better.
- Step "goal" must be one of: ${FUNNEL_GOALS.map((goal) => goal.value).join(", ")}, or null.
- "offer.ref" must be the EXACT name of one of the coach's existing products, taken from their answers. If they did not name one, return null. Never invent a product name.
- "starts_at"/"ends_at" are ISO dates, and only for a template that asks for dates. Otherwise null.
- "description" is 2-4 sentences a page writer could work from: who it is for, what they get, what happens next. It is the brief for every step, so write it as instructions, not marketing copy.
- "name" is what the coach would call this in a list — short, no year unless they gave one.

Return only the plan.`
}

function briefUser(brief: string): string {
  return `What they want to build:\n${brief.slice(0, BRIEF_MAX_LENGTH)}`
}

/** Step 1 — Haiku. Returns the questions to put in front of the owner. */
export async function interviewQuestions(
  brief: string,
  kind: CreateKind = "funnel",
): Promise<InterviewQuestion[]> {
  const system = kind === "page" ? PAGE_QUESTIONS_SYSTEM : FUNNEL_QUESTIONS_SYSTEM
  const result = await callAgent(system, briefUser(brief), questionsSchema, {
    model: MODEL_HAIKU,
    maxTokens: 1200,
  })
  return result.content.questions
}

/** Step 2 — Sonnet. Returns the plan, still unsanitised. */
export async function draftFunnelPlan(
  brief: string,
  answers: { question: string; answer: string }[],
): Promise<RawFunnelPlan> {
  const transcript = answers
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer.slice(0, ANSWER_MAX_LENGTH)}`)
    .join("\n\n")

  const result = await callAgent(
    planSystem(),
    `${briefUser(brief)}\n\nWhat they told us:\n${transcript}`,
    planSchema,
    { model: MODEL_SONNET, maxTokens: 2000 },
  )
  return result.content as RawFunnelPlan
}

// ---------------------------------------------------------------------------
// LANDING PAGES.
//
// A page interview asks different questions and returns a different shape. The
// temptation is to reuse the funnel prompt and ignore the step fields — that
// produces questions about sequences the owner cannot build ("what happens
// after they sign up?" has no second page to happen on), and a plan whose most
// important field, the goal, was never asked about.
// ---------------------------------------------------------------------------

const PAGE_QUESTIONS_SYSTEM = `You help a strength-and-conditioning coach set up a single landing page. Given one sentence about what they want, ask the ${MIN_QUESTIONS}-${MAX_QUESTIONS} questions whose answers would most change the finished page.

Ask about things only they can know — who the page is for, what is being offered and on what terms, what the visitor is being asked to do, what objection stops them, what happens after they act. NEVER ask about page layout, sections, URLs, or how many pages there are: this is ONE page and the system decides its structure.

Each question is one short sentence, answerable in a line or two. No compound questions.

Return only the questions.`

const pageGoalCatalogue = () =>
  FUNNEL_GOALS.map((goal) => `- ${goal.value}: ${goal.label} — ${goal.hint}`).join("\n")

const pagePlanSchema = z.object({
  goal: z.enum(FUNNEL_GOALS.map((goal) => goal.value) as [string, ...string[]]),
  name: z.string().min(1).max(120),
  audience: z.string().max(300).nullable(),
  description: z.string().max(500).nullable(),
})

function pagePlanSystem(): string {
  return `You turn a coach's brief and their answers into a plan for ONE landing page.

Choose the goal that matches what the page is for:
${pageGoalCatalogue()}

Rules:
- "goal" decides the page's call to action, so pick the one the visitor is actually being asked to do. If they are only collecting details, that is "leads".
- "name" is what the coach would call this in a list — short, and only their words.
- "audience" is who the page is written for, in one line.
- "description" is 2-4 sentences a page writer could work from: who it is for, what they get, what they are asked to do, and the objection to answer. It is the brief for the page, so write instructions, not marketing copy.

Return only the plan.`
}

/** Step 2, pages. Sonnet, same as the funnel side. */
export async function draftPagePlan(
  brief: string,
  answers: { question: string; answer: string }[],
): Promise<Record<string, unknown>> {
  const transcript = answers
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer.slice(0, ANSWER_MAX_LENGTH)}`)
    .join("\n\n")

  const result = await callAgent(
    pagePlanSystem(),
    `${briefUser(brief)}\n\nWhat they told us:\n${transcript}`,
    pagePlanSchema,
    { model: MODEL_SONNET, maxTokens: 1500 },
  )
  return result.content as Record<string, unknown>
}
