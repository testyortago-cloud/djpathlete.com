// POST /api/quiz/progress — the background write as a visitor walks the quiz.
//
// WHY IT EXISTS AT ALL. The result is gated behind a details form, so without
// this a visitor who leaves at question eight is worth nothing. With it they
// are a known attempt carrying eight real answers, which is what makes a
// drop-off report possible and what makes "answer everything, then gate the
// result" an honest design rather than a way to lose people quietly.
//
// THREE THINGS THIS ROUTE DOES NOT TRUST:
//   1. the branch — derived from the router ANSWER, never read from the body.
//      Taking it from the client would let a visitor choose which archetype
//      sequence they are enrolled into and which questions they are asked.
//   2. the answers — filtered through `sanitiseAnswers` against the real
//      definition, so a forged option id never lands in the stored row.
//   3. the quiz — a non-active quiz 404s, so a draft cannot collect answers.
//
// It writes no contact, no consent and no score. Only `/api/quiz/submit` does.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §4.2

import { NextResponse } from "next/server"
import { z } from "zod"
import { createAttempt, getAttempt, getQuizDefinition, saveAttemptProgress } from "@/lib/db/quizzes"
import { sanitiseAnswers } from "@/lib/quizzes/score"
import { resolvePublicTenant } from "@/lib/tenancy/public"

export const runtime = "nodejs"

/** Per-IP throttle. In-memory: resets on deploy, which is fine for spam. */
const RATE_LIMIT_WINDOW_MS = 60_000
// Higher than the form route's 5: one visitor legitimately posts progress once
// per question, and a walk is a dozen questions. Five would throttle an honest
// athlete halfway through.
const RATE_LIMIT_MAX = 40
const recentByIp = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  recentByIp.set(ip, hits)
  if (recentByIp.size > 5000) recentByIp.clear()
  return hits.length > RATE_LIMIT_MAX
}

const answerSchema = z.object({
  questionId: z.string().uuid(),
  optionId: z.string().uuid(),
})

const bodySchema = z.object({
  quizId: z.string().uuid(),
  attemptId: z.string().uuid().optional(),
  answers: z.array(answerSchema).max(200),
  attributionSessionId: z.string().max(120).nullish(),
})

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid progress." }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: "Invalid progress." }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 })
  }

  // THE HOST'S TENANT, RESOLVED FIRST, ON EVERY REQUEST (G35). This route
  // DECIDES an attempt's business. Until G35 it asked the Host only when
  // creating one, after reading the quiz by id alone, and nothing compared the
  // quiz's business with the attempt's. Business B's host could open an
  // attempt (stamped B) on business A's quiz, and /api/quiz/submit, which
  // inherits the attempt's business, then filed B's contact, card and consent
  // row against A's quiz. Now the quiz is read under the Host, and an existing
  // attempt must carry the same business. This runs after the throttle, so a
  // flood costs no business_domains read.
  const businessId = await resolvePublicTenant()

  const definition = await getQuizDefinition(businessId, body.quizId)
  // 404, not 403: a draft quiz is not a permissions problem, it is a quiz that
  // is not open. It is the same answer for "no such quiz" and for another
  // business's quiz, so probing tells you nothing.
  if (!definition || definition.status !== "active") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const answers = sanitiseAnswers(definition, body.answers)

  // THE BRANCH IS DERIVED, NEVER SENT. The first router option the visitor
  // actually chose decides it; the body has nowhere to say otherwise.
  const branchId = routerBranchFrom(definition, answers)

  let attemptId = body.attemptId
  if (attemptId) {
    const existing = await getAttempt(attemptId)
    // Silently ignoring a foreign or finished attempt would let one visitor
    // overwrite another's row, so both are refused outright. "Foreign" means
    // another quiz or, since G35, another business. The attempt id is a bearer
    // token (see `getAttempt`), and the Host says which business this request
    // is for. It is checked BEFORE the status, so another business's finished
    // attempt gets the same 404 rather than a 409 that confirms the id is real.
    if (!existing || existing.quizId !== body.quizId || existing.businessId !== businessId) {
      return NextResponse.json({ error: "Not found." }, { status: 404 })
    }
    if (existing.status !== "in_progress") {
      return NextResponse.json({ error: "This quiz has already been completed." }, { status: 409 })
    }
    await saveAttemptProgress({ attemptId, branchId, answers })
  } else {
    // PUBLIC ROUTE, NO SESSION. The attempt's tenant is DECIDED here: the
    // Host's, resolved at the top of this handler and already used to read the
    // quiz. It is NOT resolved a second time, because two lookups are two
    // answers that could disagree. /api/quiz/submit then inherits it from the
    // attempt row rather than resolving again.
    attemptId = await createAttempt(businessId, {
      quizId: body.quizId,
      attributionSessionId: body.attributionSessionId ?? null,
    })
    await saveAttemptProgress({ attemptId, branchId, answers })
  }

  return NextResponse.json({ attemptId })
}

/**
 * Duplicated deliberately from `score.ts`'s private `branchFromAnswers`: that
 * one is internal to scoring and exported nowhere, and widening its API to
 * serve a route would make the pure module's surface depend on a caller. Six
 * lines, one obvious meaning.
 */
function routerBranchFrom(
  definition: Awaited<ReturnType<typeof getQuizDefinition>> & object,
  answers: { questionId: string; optionId: string }[],
): string | null {
  const routers = definition.questions
    .filter((question) => question.branchId === null)
    .slice()
    .sort((a, b) => a.position - b.position)
  for (const question of routers) {
    for (const answer of answers) {
      if (answer.questionId !== question.id) continue
      const option = question.options.find((candidate) => candidate.id === answer.optionId)
      if (option?.routesToBranchId) return option.routesToBranchId
    }
  }
  return null
}
