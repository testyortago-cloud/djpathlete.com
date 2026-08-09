import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { publishStepSchema } from "@/lib/validators/funnel"
import { getStep, publishStep } from "@/lib/db/funnels"

/**
 * Compiles the editor output and, if clean, writes an immutable version row.
 *
 * A compile failure returns 422 with the specific problems and writes nothing —
 * the live page keeps serving whatever it was already serving.
 */
export const POST = withAudit(
  { action: "funnel.published", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { stepId } = await ctx.params

    const body = await request.json().catch(() => null)
    const parsed = publishStepSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
      const step = await getStep(stepId)
      if (!step) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const result = await publishStep({
        stepId,
        html: parsed.data.html,
        css: parsed.data.css,
        projectData: parsed.data.project_data,
        publishedBy: session.user.id,
      })

      if (!result.ok) {
        return NextResponse.json(
          {
            error: "This page could not be published.",
            problems: result.errors.map((e) => e.message),
          },
          { status: 422 },
        )
      }

      return NextResponse.json({
        version: result.version.version,
        warnings: result.warnings.map((w) => w.message),
      })
    } catch (error) {
      console.error("[POST /api/admin/funnels/steps/:stepId/publish]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
