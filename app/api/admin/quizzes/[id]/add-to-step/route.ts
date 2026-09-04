// POST /api/admin/quizzes/[id]/add-to-step — put this quiz on a funnel page.
//
// WHY THIS ROUTE EXISTS, and it is not a convenience.
//
// A section can only be ORIGINATED two ways in this app: the AI page builder
// emits `set_page`/`add_section`, or something hand-builds an op for
// `PUT /api/admin/funnels/steps/[stepId]/edit`. The builder UI itself only ever
// emits `update_section` and `move_section` — there is no add-a-section palette
// for any kind.
//
// `quiz` is deliberately withheld from the builder prompt
// (`NOT_OFFERED_TO_THE_BUILDER`), because the model cannot author a `quizId`
// the publish gate would accept. That is right, and on its own it would have
// left the kind UNREACHABLE: full registry, compiler, renderer and publish-gate
// support behind a door with no handle. This is the handle.
//
// It is also the only path that CAN be correct, because the one thing the model
// cannot know — which quiz — is exactly what the owner is choosing here.
//
// IT REUSES THE INSPECTOR'S WRITE PATH RATHER THAN INVENTING A SECOND ONE:
// the same `applyOps` grammar, the same `appendTurn` compare-and-swap on
// `doc_revision`, the same `source: "inspector"` turn in the transcript. A
// second writer into a SectionDoc is the failure this subsystem has paid for.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { appendTurn, getDraft } from "@/lib/db/funnel-builder"
import { applyOps } from "@/lib/funnels/sections/apply"
import { getQuizDefinition, assertQuizInBusiness, QuizNotInBusinessError } from "@/lib/db/quizzes"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

export const runtime = "nodejs"

const bodySchema = z.object({
  stepId: z.string().uuid(),
  /** Appended after this section, or at the top when null. */
  after: z.string().nullable().optional(),
})

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 })
}

export const POST = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (session?.user?.role !== "admin") return notFound()

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return notFound()
      throw err
    }

    const params = (await ctx.params) as Record<string, string>
    const quizId = params.id
    if (!z.string().uuid().safeParse(quizId).success) return notFound()

    // CROSS-TENANT COMPOSITION GUARD. `getQuizDefinition` below is scoped by
    // id alone (several of its other callers are public, unauthenticated
    // quiz-taking routes with no tenant to check against yet), so without
    // this an admin could compose another business's quiz onto their own
    // funnel page -- same shape as the saveQuizDefinition hole this task
    // already closed, except this route already holds a real businessId.
    try {
      await assertQuizInBusiness(businessId, quizId)
    } catch (err) {
      if (err instanceof QuizNotInBusinessError) return notFound()
      throw err
    }

    let body: z.infer<typeof bodySchema>
    try {
      const parsed = bodySchema.safeParse(await request.json())
      if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 })
      body = parsed.data
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 })
    }

    // The quiz must EXIST before it goes on a page. The publish gate would
    // catch an invented id later, but "later" means after the owner has
    // published and a visitor has seen it.
    const quiz = await getQuizDefinition(quizId)
    if (!quiz) return notFound()

    const draft = await getDraft(body.stepId)
    if (!draft || !draft.doc) {
      return NextResponse.json(
        { error: "That page has no content yet.", problems: ["Describe the page in the chat first, then add the quiz."] },
        { status: 422 },
      )
    }

    // A short, stable, schema-legal id: lowercase, starts with a letter.
    const existing = new Set(draft.doc.sections.map((section) => section.id))
    let id = "quiz1"
    for (let n = 1; existing.has(id); n++) id = `quiz${n + 1}`

    const op = {
      op: "add_section" as const,
      after: body.after ?? draft.doc.sections[draft.doc.sections.length - 1]?.id ?? null,
      section: {
        id,
        kind: "quiz" as const,
        variant: "boxed",
        style: {},
        props: { heading: quiz.name, quizId, submitLabel: "See my result" },
      },
    }

    // Validated by the ONE owner of the op grammar, not by a second copy here.
    const applied = applyOps(draft.doc, [op])
    if (!applied.ok) {
      return NextResponse.json({ error: "The quiz could not be added.", problems: applied.errors }, { status: 422 })
    }

    const written = await appendTurn({
      stepId: body.stepId,
      expectedRevision: draft.revision,
      role: "user",
      source: "inspector",
      status: "complete",
      message: `Added the "${quiz.name}" quiz to this page.`,
      ops: [op],
      doc: applied.doc,
    })
    if (!written.ok) {
      return NextResponse.json(
        { error: "This page changed while you were editing.", problems: ["Reload and try again."] },
        { status: 409 },
      )
    }

    return NextResponse.json({ ok: true, sectionId: id })
  },
)
