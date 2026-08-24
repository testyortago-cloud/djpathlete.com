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
import { getQuizDefinition, saveQuizDefinition } from "@/lib/db/quizzes"
import { quizGate } from "@/lib/quizzes/gate"

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
})

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return notFound()

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
  await saveQuizDefinition({
    quizId: id,
    quiz: quizWithoutStatus,
    questions: body.questions,
    options: body.options,
    tiers: body.tiers,
    profiles: body.profiles,
    branches: body.branches,
  })

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

  if (body.quiz?.status !== undefined) {
    await saveQuizDefinition({ quizId: id, quiz: { status: body.quiz.status } })
  }

  return NextResponse.json({ ok: true, gate })
}
