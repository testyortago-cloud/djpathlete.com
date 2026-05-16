import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { performanceTestFormSchema } from "@/lib/validators/performance-test"
import { update, deleteTest, getById } from "@/lib/db/performance-tests"
import { withAudit } from "@/lib/audit/with-audit"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const body = await req.json()
  const parsed = performanceTestFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const test = await update(id, parsed.data)
  return NextResponse.json({ test })
}

export const DELETE = withAudit(
  {
    action: "performance_test.deleted",
    category: "client_action",
    target: async (_req, ctx) => {
      const { id } = (await ctx.params) as { id: string }
      return { type: "performance_test", id }
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
    await deleteTest(id)
    return NextResponse.json({ ok: true })
  },
)
