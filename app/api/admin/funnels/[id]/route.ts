import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { updateFunnelSchema } from "@/lib/validators/funnel"
import { getFunnelById, updateFunnel, deleteFunnel, listSteps } from "@/lib/db/funnels"

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
    const parsed = updateFunnelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    try {
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
  async (_request, ctx) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    try {
      await deleteFunnel(id)
      return NextResponse.json({ ok: true })
    } catch (error) {
      console.error("[DELETE /api/admin/funnels/:id]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
