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
