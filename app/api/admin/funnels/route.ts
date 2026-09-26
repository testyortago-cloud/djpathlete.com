import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { createFunnelSchema } from "@/lib/validators/funnel"
import { listFunnels, createFunnel } from "@/lib/db/funnels"
import { SlugTakenError } from "@/lib/db/businesses"
import { createQuizFrom, deleteQuiz, getQuizDefinition, assertQuizInBusiness, QuizNotInBusinessError } from "@/lib/db/quizzes"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { buildQuizFunnelDoc } from "@/lib/funnels/quiz-funnel-doc"
import { getTemplate } from "@/lib/funnels/templates"
import { isBuiltinQuizSource } from "@/lib/quizzes/sources"
import { RPI_ATHLETE_QUIZ, toDefinition } from "@/lib/quizzes/seed/rpi-athlete-quiz"

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  try {
    return NextResponse.json({ funnels: await listFunnels(businessId) })
  } catch (error) {
    console.error("[GET /api/admin/funnels]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(
  {
    action: "funnel.created",
    category: "admin_write",
    // AUDIT §4 #12: unlike PATCH/DELETE on `[id]/route.ts`, THIS ROUTE HAS NO
    // DYNAMIC SEGMENT -- there is no `ctx.params` id to fall back to at all,
    // so before `withAudit` grew a response-aware resolver this row could
    // never have carried a target. The created funnel's id only exists once
    // `createFunnel` has run, i.e. only in the response body. A refused
    // create (validation, duplicate slug, tenant) has no `funnel` key, so
    // this correctly resolves to no target rather than inventing one.
    target: async (_request, _ctx, response) => {
      if (!response) return undefined
      try {
        const body = (await response.json()) as { funnel?: { id?: string; name?: string } }
        return body.funnel?.id
          ? { type: "funnel", id: body.funnel.id, ...(body.funnel.name ? { label: body.funnel.name } : {}) }
          : undefined
      } catch {
        return undefined
      }
    },
    metadata: async (_request, response) => {
      try {
        const body = (await response.json()) as {
          funnel?: { slug?: string; kind?: string; template?: string | null }
        }
        return { slug: body.funnel?.slug, kind: body.funnel?.kind, template: body.funnel?.template ?? null }
      } catch {
        return {}
      }
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
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
      const isBuiltin = isBuiltinQuizSource(quizIntake.copyFrom)
      // Under THIS business (G35): another business's quiz reads as absent,
      // and gets the same "no longer exists" 400 as an invented id.
      const source = isBuiltin
        ? toDefinition(RPI_ATHLETE_QUIZ)
        : await getQuizDefinition(businessId, quizIntake.copyFrom)
      if (!source) {
        // 400 NAMING THE FIELD, not a 500 from inside `createQuizFrom`. The
        // publish gate would catch an invented id eventually, but eventually
        // means after the owner published and a visitor saw the page.
        return NextResponse.json(
          { error: "Invalid request", details: [{ path: "quiz.copyFrom", message: "That quiz no longer exists." }] },
          { status: 400 },
        )
      }

      // CROSS-TENANT CLONE GUARD, skipped for the built-in sentinel (not a
      // database row at all). Without it an admin could clone another
      // business's full quiz content into their own by naming its id as
      // `copyFrom`. Since G35 the read above refuses that too, so this is the
      // second of two checks giving the same answer. Same message and status
      // as "does not exist": telling the two apart would confirm the id names
      // a real quiz somewhere, just not one this caller may see.
      if (!isBuiltin) {
        try {
          await assertQuizInBusiness(businessId, quizIntake.copyFrom)
        } catch (err) {
          if (err instanceof QuizNotInBusinessError) {
            return NextResponse.json(
              { error: "Invalid request", details: [{ path: "quiz.copyFrom", message: "That quiz no longer exists." }] },
              { status: 400 },
            )
          }
          throw err
        }
      }

      const clone = await createQuizFrom(businessId, { source, name: funnelIntake.name })
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
      const { entryStepId, ...funnel } = await createFunnel(businessId, {
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
        await deleteQuiz(businessId, createdQuizId).catch((cleanupError) =>
          console.error("[POST /api/admin/funnels] orphaned quiz", createdQuizId, cleanupError),
        )
      }
      // BY TYPE, NOT BY MESSAGE SUBSTRING. `SlugTakenError`'s wording
      // ("The web address ... is already taken") was changed under this
      // route without updating a `message.includes("duplicate" | "unique")`
      // check that used to catch it — so every duplicate slug fell through
      // to the generic 500 below instead of the field error the create
      // dialog renders. Catching the TYPE cannot be broken by a wording
      // change on either side again.
      if (error instanceof SlugTakenError) {
        return NextResponse.json({ error: "That slug is already in use." }, { status: 409 })
      }
      console.error("[POST /api/admin/funnels]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
