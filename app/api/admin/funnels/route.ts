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
      // Split the entry step id back out rather than nesting it inside
      // `funnel`: every existing caller reads `body.funnel` as a Funnel row, and
      // widening that shape would be a silent change to all of them.
      // `parsed.data` spreads straight through: every intake field the schema
      // accepts is a field `CreateFunnelInput` names, so adding one to the
      // validator does not need a second edit here. `offer` stays nested and is
      // split into its two columns by the DAL, which is where the paired CHECK
      // is honoured.
      const { entryStepId, ...funnel } = await createFunnel({
        ...parsed.data,
        created_by: session.user.id,
      })
      return NextResponse.json({ funnel, entryStepId }, { status: 201 })
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
