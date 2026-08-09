import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { updateStepSchema } from "@/lib/validators/funnel"
import { getStep, updateStep, deleteStep } from "@/lib/db/funnels"

/** Saves the editor draft and step settings. Never changes the live page. */
export const PATCH = withAudit(
  { action: "funnel.updated", category: "admin_write" },
  async (request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { stepId } = await ctx.params

    const body = await request.json().catch(() => null)
    const parsed = updateStepSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
      const step = await getStep(stepId)
      if (!step) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ step: await updateStep(stepId, parsed.data) })
    } catch (error) {
      console.error("[PATCH /api/admin/funnels/steps/:stepId]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  { action: "funnel.deleted", category: "admin_write" },
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { stepId } = await ctx.params

    try {
      const step = await getStep(stepId)
      if (!step) return NextResponse.json({ error: "Not found" }, { status: 404 })
      if (step.is_entry) {
        return NextResponse.json(
          { error: "The entry page cannot be deleted. Delete the funnel instead." },
          { status: 409 },
        )
      }
      await deleteStep(stepId)
      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("[DELETE /api/admin/funnels/steps/:stepId]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
