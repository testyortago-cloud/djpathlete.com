import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"
import { archive, getById, markAchieved, update } from "@/lib/db/athlete-goals"
import { withAudit } from "@/lib/audit/with-audit"

export const PATCH = withAudit(
  {
    action: "goal.updated",
    category: "client_action",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "athlete_goal", id }
    },
  },
  async (req, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const { id } = await params
    const existing = await getById(id)
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const body = await req.json()
    if (body.action === "archive") {
      const goal = await archive(id)
      return NextResponse.json({ goal })
    }
    if (body.action === "achieve") {
      const goal = await markAchieved(id, new Date().toISOString().slice(0, 10))
      return NextResponse.json({ goal })
    }
    const parsed = athleteGoalFormSchema.partial().safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
    }
    const goal = await update(id, parsed.data)
    return NextResponse.json({ goal })
  },
)

export const DELETE = withAudit(
  {
    action: "goal.deleted",
    category: "client_action",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "athlete_goal", id }
    },
  },
  async (_req, context) => {
    const { params } = context as unknown as { params: Promise<{ id: string }> }
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const { id } = await params
    const existing = await getById(id)
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    await archive(id)
    return NextResponse.json({ ok: true })
  },
)
