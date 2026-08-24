// A TEST RUN OF A QUIZ ON AN UNPUBLISHED PAGE.
//
// Sibling of `/api/funnels/preview-submit`, and it pays the same two costs for
// the same two reasons:
//
//   1. IT IS ADMIN/STAFF GATED and answers 404 to everyone else — the same
//      fail-closed shape as the preview page it is submitted from.
//
//   2. IT WRITES NOTHING. No attempt row, no contact, no consent, no timeline
//      event, no enrolment, no pipeline card, no email. A quiz preview that
//      wrote an attempt would put fake leads and fake scores into the drop-off
//      report and the campaign numbers, and "remember to filter them out" is
//      exactly the promise an is_test column fails to keep. Writing nothing
//      satisfies it by construction. A test reads this file and asserts no
//      write path appears in it at all.
//
// IT SCORES AGAINST THE DRAFT. The live route refuses a quiz that is not
// active, which is correct there and useless here — the whole point of a
// preview is to try a quiz before it goes live. This route therefore reads the
// definition whatever its status, runs the SAME pure `scoreQuiz`, and returns
// the same shape, so what the owner sees in preview is what a visitor will get.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §2.3

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { sanitiseAnswers, scoreQuiz } from "@/lib/quizzes/score"

export const runtime = "nodejs"

const bodySchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() })).max(200),
})

/** 404, never 403 — the route does not confirm what exists to a stranger. */
function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 })
}

export async function POST(request: Request) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") return notFound()

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  }

  // WHATEVER ITS STATUS. A draft is the normal case here.
  const definition = await getQuizDefinition(body.quizId)
  if (!definition) return notFound()

  // DELIBERATELY REDUNDANT, and worth saying so: for SCORING this call is a
  // no-op. `scoreQuiz` already ignores an option that does not belong to its
  // question, already keeps the last of a duplicated answer, and already walks
  // only active questions — and this route stores nothing, which is where
  // sanitisation actually earns its keep on the live route. It is here so the
  // preview runs the identical sequence to `/api/quiz/submit`; a preview that
  // took a shorter path is a preview that can disagree with the real thing.
  const answers = sanitiseAnswers(definition, body.answers)
  const result = scoreQuiz(definition, answers)

  const tier = definition.tiers.find((candidate) => candidate.key === result.tierKey) ?? null
  const profile = definition.profiles.find((candidate) => candidate.key === result.profileKey) ?? null
  const branch = definition.branches.find((candidate) => candidate.key === result.branchKey) ?? null

  return NextResponse.json({
    testRun: true,
    score: result.score,
    tier: tier
      ? { key: tier.key, headline: tier.headline, body: tier.body, ctaLabel: tier.ctaLabel, ctaHref: tier.ctaHref }
      : null,
    profile: profile ? { key: profile.key, name: profile.name, description: profile.description } : null,
    branch: branch ? { key: branch.key, name: branch.name } : null,
  })
}
