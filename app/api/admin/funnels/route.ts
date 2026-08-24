import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { createFunnelSchema } from "@/lib/validators/funnel"
import { listFunnels, createFunnel } from "@/lib/db/funnels"
import { createQuizFrom, deleteQuiz, getQuizDefinition } from "@/lib/db/quizzes"
import { buildQuizFunnelDoc } from "@/lib/funnels/quiz-funnel-doc"
import { getTemplate } from "@/lib/funnels/templates"
import { isBuiltinQuizSource } from "@/lib/quizzes/sources"
import { RPI_ATHLETE_QUIZ, toDefinition } from "@/lib/quizzes/seed/rpi-athlete-quiz"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    return NextResponse.json({ funnels: await listFunnels() })
  } catch (error) {
    console.error("[GET /api/admin/funnels]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(
  { action: "funnel.created", category: "admin_write" },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const parsed = createFunnelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      )
    }

    // -----------------------------------------------------------------------
    // THE QUIZ TEMPLATE IS THE ONE TEMPLATE WHOSE PAGE ARRIVES ALREADY WRITTEN.
    //
    // It is also the only create that touches a second subsystem, so the order
    // matters: the page cannot name the quiz until the quiz exists, which
    // means the clone is inserted first and deleted again below if the funnel
    // insert then fails. The worst case that leaves is a draft quiz in the
    // list — visible, and deletable. The other order's worst case is a quiz
    // funnel with a hole where its quiz should be, which is neither.
    //
    // `quiz` is split out of `parsed.data` rather than spread through:
    // `funnels` has no such column, and spreading a widened payload straight
    // into the DAL is how a PATCH carrying `offer` once reached Postgres.
    // -----------------------------------------------------------------------
    const { quiz: quizIntake, ...funnelIntake } = parsed.data
    let createdQuizId: string | null = null
    let plannedSteps = funnelIntake.steps

    if (quizIntake) {
      // The built-in is a SENTINEL, not a row: `RPI_ATHLETE_QUIZ` is a typed
      // module, and `toDefinition` is the same conversion its own gate test
      // uses. Treating it as an id would send "builtin:rpi" to a uuid column.
      const source = isBuiltinQuizSource(quizIntake.copyFrom)
        ? toDefinition(RPI_ATHLETE_QUIZ)
        : await getQuizDefinition(quizIntake.copyFrom)
      if (!source) {
        // 400 NAMING THE FIELD, not a 500 from inside `createQuizFrom`. The
        // publish gate would catch an invented id eventually, but eventually
        // means after the owner published and a visitor saw the page.
        return NextResponse.json(
          { error: "Invalid request", details: [{ path: "quiz.copyFrom", message: "That quiz no longer exists." }] },
          { status: 400 },
        )
      }

      const clone = await createQuizFrom({ source, name: funnelIntake.name })
      createdQuizId = clone.id
      const page = buildQuizFunnelDoc({ quizId: clone.id })

      // FROM THE TEMPLATE WHEN THE BODY SENDS NO PLAN. `createFunnel` falls
      // back to a single unnamed entry step, and mapping over an absent plan
      // would silently produce exactly that — a quiz funnel with a blank page.
      const base =
        plannedSteps && plannedSteps.length > 0
          ? plannedSteps
          : (getTemplate(funnelIntake.template)?.steps ?? []).map((step) => ({
              name: step.name,
              slug: step.slug,
              goal: step.goal,
            }))
      plannedSteps = base.map((step, index) => (index === 0 ? { ...step, projectData: page } : step))
    }

    try {
      // Split the entry step id back out rather than nesting it inside
      // `funnel`: every existing caller reads `body.funnel` as a Funnel row, and
      // widening that shape would be a silent change to all of them.
      // `parsed.data` spreads straight through: every intake field the schema
      // accepts is a field `CreateFunnelInput` names, so adding one to the
      // validator does not need a second edit here. `offer` stays nested and is
      // split into its two columns by the DAL, which is where the paired CHECK
      // is honoured.
      const { entryStepId, ...funnel } = await createFunnel({
        ...funnelIntake,
        steps: plannedSteps,
        created_by: session.user.id,
      })
      // `quizId` ONLY WHEN ONE WAS MADE. The dialog routes into the quiz
      // editor rather than the page builder for a quiz funnel: the page is
      // already written, and what is unwritten is the twelve questions.
      return NextResponse.json(
        { funnel, entryStepId, ...(createdQuizId ? { quizId: createdQuizId } : {}) },
        { status: 201 },
      )
    } catch (error) {
      if (createdQuizId) {
        // Best effort, and logged when it fails: an orphan draft quiz is a
        // smaller problem than the one already being reported, so its own
        // failure must not replace the original error.
        await deleteQuiz(createdQuizId).catch((cleanupError) =>
          console.error("[POST /api/admin/funnels] orphaned quiz", createdQuizId, cleanupError),
        )
      }
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("duplicate") || message.includes("unique")) {
        return NextResponse.json({ error: "That slug is already in use." }, { status: 409 })
      }
      console.error("[POST /api/admin/funnels]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
