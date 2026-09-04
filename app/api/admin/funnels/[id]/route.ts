import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { updateFunnelSchema } from "@/lib/validators/funnel"
import { getFunnelById, updateFunnel, deleteFunnel, listSteps, listStepDocuments } from "@/lib/db/funnels"
import { deleteQuiz } from "@/lib/db/quizzes"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { quizUsesInSteps } from "@/lib/funnels/quiz-refs"

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params
  try {
    const funnel = await getFunnelById(id)
    if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ funnel, steps: await listSteps(id) })
  } catch (error) {
    console.error("[GET /api/admin/funnels/:id]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const PATCH = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    const body = await request.json().catch(() => null)

    // `kind` IS SET AT CREATION AND NEVER CHANGES. The Convert-to-funnel
    // control was removed on the owner's ruling that landing pages and
    // funnels are separate things which never turn into each other. The
    // schema below no longer carries the field, and Zod would silently STRIP
    // it — reporting success for a change that did not happen — so a body
    // naming it is refused out loud instead. Checked on the RAW body, before
    // parsing, precisely because the parsed shape can no longer see it.
    if (body !== null && typeof body === "object" && "kind" in body) {
      return NextResponse.json(
        { error: "A landing page or funnel keeps the kind it was created with. Neither converts into the other." },
        { status: 400 },
      )
    }

    const parsed = updateFunnelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
      /**
       * THIS ROUTE DOES NOT PUBLISH A FUNNEL. It never did more than flip
       * `funnels.status` — see `steps/[stepId]/publish/route.ts`'s header for
       * the same shape of defect on that route, fixed the same way: a direct
       * POST there once skipped every gate the UI ran, and published a page
       * with dead buy buttons. Here the UI-only guard is `FunnelStatusControl`
       * and `FunnelGoLiveButton` routing `kind === "funnel"` through
       * `POST .../publish` instead of this PATCH — but a body-level check the
       * browser happens to make is not a guard, it is a request for one, and a
       * direct `PATCH {"status":"published"}` on a funnel row would reproduce
       * the exact "funnel published, pages are not" split this branch exists
       * to eliminate.
       *
       * ONLY `kind === "funnel"` IS REFUSED, and only for `status: "published"`.
       * A landing page (`kind === "page"`) legitimately publishes through this
       * body — its one step is already gated by the step publish route, which
       * is what flips a page's row live — so it is let through unchanged.
       * Unpublishing and archiving are also let through for both kinds: taking
       * something off the air has nothing to gate, and refusing to hide a
       * broken funnel because it is broken would be exactly backwards.
       *
       * 400, not 422: this is not `updateFunnelSchema` failing to parse a
       * shape (that path already returns 400 above) and not the publish
       * route's own gate refusing a document it inspected (that is 422,
       * reserved for a request this route never receives). It is a
       * well-formed, schema-valid body that is not a legal operation on THIS
       * route for THIS row — the same class of refusal
       * `[id]/publish/route.ts` gives a funnel with no pages, which is also a
       * 400 in this file family, not a 403 (nothing about who is asking) or a
       * 409 (nothing here conflicts with concurrent state).
       */
      /**
       * `kind` NEVER REACHES THIS POINT — the body-level refusal above runs
       * before parsing, and the schema no longer carries the field. That is
       * what closed the old two-request publish bypass (demote the row to
       * "page", then publish it ungated): with `kind` frozen at creation, the
       * STORED kind is the only kind there is, so gating on it is complete.
       */
      if (parsed.data.status === "published") {
        const funnel = await getFunnelById(id)
        if (!funnel) return NextResponse.json({ error: "Not found" }, { status: 404 })

        if (funnel.kind === "funnel") {
          return NextResponse.json(
            {
              error:
                "A funnel is published as a whole. Use POST /api/admin/funnels/:id/publish, which gates every page before any of them go live.",
            },
            { status: 400 },
          )
        }
      }

      return NextResponse.json({ funnel: await updateFunnel(id, parsed.data) })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("duplicate") || message.includes("unique")) {
        return NextResponse.json({ error: "That slug is already in use." }, { status: 409 })
      }
      console.error("[PATCH /api/admin/funnels/:id]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  { action: "funnel.deleted", category: "admin_write" },
  async (request, ctx) => {
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

    const { id } = await ctx.params
    try {
      // READ THE PAGES FIRST. `funnel_steps.funnel_id` is ON DELETE CASCADE, so
      // once the funnel row goes its steps go with it -- and the quiz pointer
      // lives inside those steps' documents. After the delete there is nothing
      // left to ask.
      //
      // Degrades to "no quizzes" rather than blocking the delete: a funnel the
      // owner asked to remove should not survive because one read failed.
      const quizUses = await listSteps(id)
        .then(quizUsesInSteps)
        .catch((error) => {
          console.error("[DELETE /api/admin/funnels/:id] could not read steps for quiz cleanup", error)
          return []
        })

      await deleteFunnel(id)

      // A QUIZ IS NOT PART OF THE FUNNEL ROW. Its block holds a POINTER, which
      // is what lets one weight edit take effect on every page showing it -- and
      // the cost is that deleting the funnel used to leave the quiz behind,
      // reachable only by typing its URL now that there is no quizzes list.
      //
      // NARROW ON PURPOSE. `quiz_attempts.quiz_id` is ON DELETE CASCADE, so this
      // destroys every answer, score and tier recorded against the quiz, and it
      // is the last copy -- `funnel_submissions` cascaded away with the funnel.
      // So a quiz ANY remaining page still points at is left alone, and the
      // owner is told what goes before they confirm (see FunnelList).
      if (quizUses.length > 0) await cleanUpOrphanedQuizzes(businessId, quizUses.map((use) => use.quizId))

      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("[DELETE /api/admin/funnels/:id]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

/**
 * Deletes each of `quizIds` that no remaining page points at.
 *
 * BEST EFFORT, AND LOGGED. The funnel row has already gone by the time this
 * runs, so throwing would answer 500 to an owner whose delete DID happen --
 * telling them nothing worked when most of it did. An orphaned quiz is a
 * nuisance; a delete the owner believes failed and repeats is worse. Same call
 * the create path makes when it has to undo a half-made quiz funnel.
 */
async function cleanUpOrphanedQuizzes(businessId: string, quizIds: string[]): Promise<void> {
  // ONE GUARD PER FAILURE MODE, and deliberately not a single try wrapping both.
  // A try around the whole body catches the scan AND the deletes, so either
  // guard alone satisfies "a failure here does not 500" -- and a test asserting
  // it stays green when either is removed, pinning neither. The scan failing
  // and a delete failing are different events with different messages, so they
  // get different handlers.
  let remaining: Awaited<ReturnType<typeof listStepDocuments>>
  try {
    remaining = await listStepDocuments()
  } catch (error) {
    // Cannot tell whether anything still points at these quizzes, so touch
    // none of them. Failing closed here is the safe direction: the cost is an
    // orphan, and the alternative is deleting a quiz another funnel is using.
    console.error("[DELETE /api/admin/funnels/:id] could not check for orphaned quizzes", error)
    return
  }

  const stillUsed = new Set(quizUsesInSteps(remaining).map((use) => use.quizId))
  for (const quizId of quizIds) {
    if (stillUsed.has(quizId)) continue
    await deleteQuiz(businessId, quizId).catch((error) =>
      console.error("[DELETE /api/admin/funnels/:id] orphaned quiz", quizId, error),
    )
  }
}
