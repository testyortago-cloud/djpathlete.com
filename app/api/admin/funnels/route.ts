import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { withAudit } from "@/lib/audit/with-audit"
import { createFunnelSchema } from "@/lib/validators/funnel"
import { listFunnels, createFunnel } from "@/lib/db/funnels"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    return NextResponse.json({ funnels: await listFunnels() })
  } catch (error) {
    console.error("[GET /api/admin/funnels]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit(
  { action: "funnel.created", category: "admin_write" },
  async (request) => {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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

    try {
      const funnel = await createFunnel({ ...parsed.data, created_by: session.user.id })
      return NextResponse.json({ funnel }, { status: 201 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("duplicate") || message.includes("unique")) {
        return NextResponse.json({ error: "That slug is already in use." }, { status: 409 })
      }
      console.error("[POST /api/admin/funnels]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
