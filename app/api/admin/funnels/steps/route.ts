import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { createStepSchema } from "@/lib/validators/funnel"
import { getFunnelById, createStep } from "@/lib/db/funnels"

/**
 * Adds a page to a funnel. Without this the funnel/step split was pointless —
 * a funnel could only ever hold the entry page created alongside it.
 */
export const POST = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const parsed = createStepSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      )
    }

    try {
      const funnel = await getFunnelById(parsed.data.funnel_id)
      if (!funnel) return NextResponse.json({ error: "Funnel not found" }, { status: 404 })

      // ---------------------------------------------------------------------
      // A LANDING PAGE IS ONE PAGE, AND THIS IS WHERE THAT BECOMES TRUE.
      // ---------------------------------------------------------------------
      // `/admin/funnels/[id]` has rendered `AddStepDialog` only for
      // `kind === "funnel"` since the split, with a comment asserting a landing
      // page "is single-page by definition". It was not: this route read the
      // funnel ONLY to 404 and never looked at `kind`, so the rule lived
      // entirely on the button. A guard on the client path is not a guard.
      //
      // It matters more than tidiness, because a `kind === "page"` row has TWO
      // doors to publication that a funnel does not:
      // `PATCH /api/admin/funnels/[id]` accepts `{status:"published"}` for a
      // page, and `steps/[stepId]/publish` FLIPS a page's row live as a side
      // effect of publishing any one of its steps. So a page that had grown
      // extra pages could be taken live with those pages unbuilt — the exact
      // "live funnel whose own buttons 404" state that
      // `[id]/publish/route.ts` and its three gates exist to prevent, reached
      // without ever touching a funnel.
      //
      // Reachable before conversion came back (create a landing page, then
      // POST here three times), so this is not the convert route's debt — but
      // the convert route's guard counts steps at one instant, and without
      // this line nothing keeps the row at one step afterwards. The two
      // together are what make "a landing page is one page" a fact rather than
      // a habit.
      if (funnel.kind === "page") {
        return NextResponse.json(
          {
            error:
              "A landing page is one page. Convert it to a funnel first, then add pages to it.",
          },
          { status: 400 },
        )
      }

      const step = await createStep(parsed.data)
      return NextResponse.json({ step }, { status: 201 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("duplicate") || message.includes("unique")) {
        return NextResponse.json(
          { error: "That page path is already used in this funnel." },
          { status: 409 },
        )
      }
      console.error("[POST /api/admin/funnels/steps]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
