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
  {
    action: "funnel.updated",
    category: "admin_write",
    // AUDIT §4 #12: this row used to carry `target_id null` -- `ctx.params`
    // only ever had the id, never a name, and a name is what makes a row
    // findable. Reads the funnel `updateFunnel` just wrote off the RESPONSE,
    // cloned so the real caller's body is untouched. A refused write (the
    // 400s above, a 404, a 409) has no `funnel` key in its body, so this
    // degrades to an id-only target with no label rather than throwing.
    target: async (_request, ctx, response) => {
      const { id } = await ctx.params
      if (!response) return { type: "funnel", id }
      try {
        const body = (await response.json()) as { funnel?: { name?: string } }
        return { type: "funnel", id, ...(body.funnel?.name ? { label: body.funnel.name } : {}) }
      } catch {
        return { type: "funnel", id }
      }
    },
    // `fields` reads the ORIGINAL, still-unconsumed request -- the handler
    // below parses a CLONE of it instead (same split `pipeline/move/route.ts`
    // uses), so this is the first real read of the request body regardless of
    // which branch the handler took. `status`/`slug`/`kind` come from the
    // RESPONSE rather than echoing the request back: a PATCH that only sends
    // `{name}` should still show the funnel's CURRENT status/slug/kind, and
    // naming exactly what changed plus what the row looks like afterward is
    // the whole fix for the unpublish this task exists to make traceable.
    metadata: async (request, response) => {
      let fields: string[] = []
      try {
        const body = (await request.json()) as Record<string, unknown> | null
        fields = body && typeof body === "object" ? Object.keys(body) : []
      } catch {
        fields = []
      }
      try {
        const body = (await response.json()) as { funnel?: { status?: string; slug?: string; kind?: string } }
        return { fields, status: body.funnel?.status, slug: body.funnel?.slug, kind: body.funnel?.kind }
      } catch {
        return { fields }
      }
    },
  },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params

    // A CLONE: the `metadata` resolver above reads the ORIGINAL request for
    // which fields the caller asked to change, and a body can only be read
    // once. Reading the clone here (instead of the original) is what leaves
    // the original available for that later read.
    const body = await request.clone().json().catch(() => null)

    // `kind` NEVER CHANGES THROUGH THIS ROUTE. A row CAN move between the two
    // boards — `POST /api/admin/funnels/[id]/convert` has done that since
    // 2026-09-08, from either card — but only there, because only there do the
    // guards run: `funnel → page` requires the row to have exactly one step,
    // and `POST /api/admin/funnels/steps` refuses a second step on a
    // `kind='page'` parent afterwards.
    //
    // Letting `kind` ride in on this PATCH would put the conversion and the
    // publish in ONE handler, separated by nothing but the order two `if`s
    // run in. That is not hypothetical: the old two-request bypass demoted a
    // broken four-page funnel to a "page", then `PATCH {status:"published"}`
    // — which this route legitimately allows for a page — and put it live with
    // three of its four pages never built.
    //
    // Checked on the RAW body, before parsing: `updateFunnelSchema` does not
    // carry the field, so Zod would silently STRIP it and this route would
    // answer 200 for a change that never happened.
    if (body !== null && typeof body === "object" && "kind" in body) {
      return NextResponse.json(
        {
          error:
            "Changing a landing page into a funnel, or back, has its own step — it runs checks this one cannot. Use the convert action on the card instead.",
        },
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
  {
    action: "funnel.deleted",
    category: "admin_write",
    // AUDIT §4 #12: same defect as PATCH above, one step worse -- `deleteFunnel`
    // removes the row outright, so there is no ROW LEFT to read a name from
    // after the fact at all. That is why the handler below now reads it
    // FIRST and echoes it back in `deleted: {...}`; this resolver reads that
    // off the response rather than re-querying a row that no longer exists.
    target: async (_request, ctx, response) => {
      const { id } = await ctx.params
      if (!response) return { type: "funnel", id }
      try {
        const body = (await response.json()) as { deleted?: { name?: string | null } }
        return { type: "funnel", id, ...(body.deleted?.name ? { label: body.deleted.name } : {}) }
      } catch {
        return { type: "funnel", id }
      }
    },
    metadata: async (_request, response) => {
      try {
        const body = (await response.json()) as {
          deleted?: { slug?: string | null; kind?: string | null; status?: string | null }
        }
        return { slug: body.deleted?.slug ?? null, kind: body.deleted?.kind ?? null, status: body.deleted?.status ?? null }
      } catch {
        return {}
      }
    },
  },
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
      // READ THE ROW, AND ITS PAGES, FIRST. `deleteFunnel` removes the
      // `funnels` row outright, and `funnel_steps.funnel_id` is ON DELETE
      // CASCADE, so once it runs there is nothing left to ask -- not the
      // slug/name/kind/status this route now hands back for the audit trail
      // (see the `target`/`metadata` resolvers above), and not the quiz
      // pointer that lives inside the steps' documents.
      //
      // Both reads degrade rather than block the delete: a funnel the owner
      // asked to remove should not survive because one read failed, and an id
      // that no longer names a row (already deleted, a stale request) simply
      // falls back to an id-only response/audit row below.
      const funnel = await getFunnelById(id).catch(() => null)
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

      return NextResponse.json({
        ok: true,
        deleted: {
          id,
          slug: funnel?.slug ?? null,
          name: funnel?.name ?? null,
          kind: funnel?.kind ?? null,
          status: funnel?.status ?? null,
        },
      })
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
