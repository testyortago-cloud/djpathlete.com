// PATCH /api/admin/quizzes/[id] — the editor's save.
//
// THE GATE IS ENFORCED HERE, NOT ONLY IN THE BUTTON. A disabled button is not
// a control: it is a courtesy to the person looking at it. Anyone who can
// reach this route can send `status: "active"` with a quiz that routes
// nowhere, and the only thing that stops a page collecting answers it cannot
// score is this check.
//
// It runs against the quiz AS IT WILL BE after the save, not as it is now —
// applying the writes and then gating would leave a broken active quiz behind
// on rejection, and gating the pre-save state would approve edits that break
// it. So: write the children, re-read, gate, and only then flip the status.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §2.2

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import {
  QuizAnsweredOptionError,
  QuizNotInBusinessError,
  getAnsweredQuestionIds,
  getQuizDefinition,
  getQuizDefinitionForEditor,
  saveQuizDefinition,
} from "@/lib/db/quizzes"
import { quizGate } from "@/lib/quizzes/gate"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

export const runtime = "nodejs"

const bodySchema = z.object({
  quiz: z
    .object({
      name: z.string().min(1).max(160).optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      introHeadline: z.string().max(200).optional(),
      introBody: z.string().max(2000).optional(),
      gateHeadline: z.string().max(200).optional(),
      gateBody: z.string().max(2000).optional(),
      resultHeadline: z.string().max(200).optional(),
      seedMarker: z.string().max(120).nullable().optional(),
    })
    .optional(),
  questions: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: z.number().int().min(0).max(10_000).optional(),
        prompt: z.string().min(1).max(500).optional(),
        helpText: z.string().max(500).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .max(500)
    .optional(),
  options: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).max(300).optional(),
        weight: z.number().min(0).max(100).optional(),
        routesToBranchId: z.string().uuid().nullable().optional(),
        profileId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(2000)
    .optional(),
  tiers: z
    .array(
      z.object({
        id: z.string().uuid(),
        minScore: z.number().int().min(0).max(100).optional(),
        maxScore: z.number().int().min(0).max(100).optional(),
        headline: z.string().max(200).optional(),
        body: z.string().max(2000).optional(),
        ctaLabel: z.string().max(60).nullable().optional(),
        ctaHref: z.string().max(300).nullable().optional(),
      }),
    )
    .max(20)
    .optional(),
  profiles: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(1000).optional(),
        position: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(50)
    .optional(),
  branches: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(1000).nullable().optional(),
        position: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(50)
    .optional(),

  // -------------------------------------------------------------------------
  // Structural edits. Every id is a uuid the EDITOR minted, so the shapes below
  // are `.min(1)`/required where the update siblings above are `.optional()`:
  // an insert has no existing row to fall back to.
  // -------------------------------------------------------------------------
  addQuestions: z
    .array(
      z.object({
        id: z.string().uuid(),
        branchId: z.string().uuid().nullable(),
        position: z.number().int().min(0).max(10_000),
        prompt: z.string().min(1).max(500),
        helpText: z.string().max(500).nullable(),
        isActive: z.boolean(),
        // TWO IS THE FLOOR, matching the gate's own "fewer than two options"
        // blocker. Accepting zero would let the editor create a question that
        // can never be switched on, whose only symptom is a blocker naming a
        // question the owner cannot see how to fix.
        options: z
          .array(
            z.object({
              id: z.string().uuid(),
              position: z.number().int().min(0).max(10_000),
              label: z.string().min(1).max(300),
              weight: z.number().min(0).max(100),
              routesToBranchId: z.string().uuid().nullable(),
              profileId: z.string().uuid().nullable(),
            }),
          )
          .min(2)
          .max(20),
      }),
    )
    .max(100)
    .optional(),
  addOptions: z
    .array(
      z.object({
        id: z.string().uuid(),
        questionId: z.string().uuid(),
        position: z.number().int().min(0).max(10_000),
        label: z.string().min(1).max(300),
        weight: z.number().min(0).max(100),
        routesToBranchId: z.string().uuid().nullable(),
        profileId: z.string().uuid().nullable(),
      }),
    )
    .max(200)
    .optional(),
  deleteQuestionIds: z.array(z.string().uuid()).max(100).optional(),
  deleteOptionIds: z.array(z.string().uuid()).max(200).optional(),
})

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return notFound()

  // Same 404-not-403 posture as the role check above: this route does not
  // confirm what exists to anyone, including an admin session with no
  // resolvable business.
  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return notFound()
    throw err
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return notFound()

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid save." }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: "Invalid save." }, { status: 400 })
  }

  const existing = await getQuizDefinition(id)
  if (!existing) return notFound()

  const wantsActive = body.quiz?.status === "active"

  // Everything EXCEPT the status flip. If the gate then refuses, the content
  // edits are kept — losing someone's morning of copy because their last
  // change did not yet satisfy the gate would be its own bug — and the quiz
  // simply stays draft.
  const { status: _requestedStatus, ...quizWithoutStatus } = body.quiz ?? {}
  let retiredQuestionIds: string[] = []
  try {
    const outcome = await saveQuizDefinition(businessId, {
      quizId: id,
      quiz: quizWithoutStatus,
      questions: body.questions,
      options: body.options,
      tiers: body.tiers,
      profiles: body.profiles,
      branches: body.branches,
      addQuestions: body.addQuestions,
      addOptions: body.addOptions,
      deleteQuestionIds: body.deleteQuestionIds,
      deleteOptionIds: body.deleteOptionIds,
    })
    retiredQuestionIds = outcome.retiredQuestionIds
  } catch (error) {
    // 400 CARRYING THE REASON, not a 500. The save was refused because
    // somebody has already picked that answer — a fact the owner can act on,
    // and one they cannot discover any other way. Matched on the class rather
    // than a message string; `saveQuizDefinition` writes nothing before it
    // throws this, so there is no half-applied save to explain.
    if (error instanceof QuizAnsweredOptionError) {
      return NextResponse.json({ error: error.message, optionIds: error.optionIds }, { status: 400 })
    }
    // Same 404-not-a-stranger posture as the rest of this route: `existing`
    // above is read by id alone (see the sweep note on `getQuizDefinition`),
    // so a quiz belonging to another business still passes that check. This
    // is the point that actually refuses it.
    if (error instanceof QuizNotInBusinessError) return notFound()
    throw error
  }

  const after = await getQuizDefinition(id)
  if (!after) return notFound()
  const gate = quizGate(after)

  if (wantsActive && !gate.ok) {
    // 409, not 400: the payload was well-formed, the resulting quiz is not
    // fit to go live. The blockers are returned so the editor can show the
    // reason rather than a bare refusal.
    return NextResponse.json(
      { error: "This quiz cannot be activated yet.", blockers: gate.blockers, warnings: gate.warnings },
      { status: 409 },
    )
  }

  // -------------------------------------------------------------------------
  // A LIVE QUIZ THAT THIS EDIT JUST BROKE IS TAKEN OFFLINE.
  //
  // The gate used to run on ACTIVATION only, which was survivable while the
  // editor could merely reword things. It is not survivable now: retiring the
  // router of a quiz that is ALREADY live would sail straight through, and the
  // published page would go on collecting answers it can no longer score —
  // exactly the failure `lib/quizzes/gate.ts` says it exists to prevent, moved
  // from the editor to in front of a lead.
  //
  // DEACTIVATE RATHER THAN REFUSE. Refusing would mean either losing the edit
  // or leaving a broken quiz live, and neither is a thing to do to somebody
  // who was in the middle of working. Taking it offline keeps their change,
  // stops the damage, and hands them the blockers.
  // -------------------------------------------------------------------------
  const wasActive = existing.status === "active"
  const staysActive = body.quiz?.status === undefined ? wasActive : body.quiz.status === "active"
  const deactivated = staysActive && !wantsActive && !gate.ok
  if (deactivated) {
    await saveQuizDefinition(businessId, { quizId: id, quiz: { status: "draft" } })
  } else if (body.quiz?.status !== undefined) {
    await saveQuizDefinition(businessId, { quizId: id, quiz: { status: body.quiz.status } })
  }

  // THE EDITOR'S READ, not the public one. `getQuizDefinition` filters out
  // inactive questions, so returning it here would make a question that was
  // just retired vanish with no way back, and a question added switched-off
  // disappear the moment it was saved. The gate above still runs against the
  // public read, because the gate is a statement about the WALK.
  const forEditor = await getQuizDefinitionForEditor(id)
  // Sent every time, not only after a retirement: the editor re-derives which
  // inactive questions are retired from this, and a stale list would relabel a
  // question the owner just turned off.
  const answeredQuestionIds = await getAnsweredQuestionIds(id).catch(() => [] as string[])
  return NextResponse.json({
    ok: true,
    gate,
    quiz: forEditor,
    answeredQuestionIds,
    retiredQuestionIds,
    deactivated,
    ...(deactivated ? { blockers: gate.blockers } : {}),
  })
}
