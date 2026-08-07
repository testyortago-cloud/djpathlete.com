import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { createAssessmentFromTemplate } from "@/lib/db/performance-assessments"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const schema = z.object({
  client_user_ids: z.array(z.string().regex(uuidRegex, "Invalid UUID")).min(1, "Select at least one athlete"),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const ids: string[] = []
    for (const clientUserId of parsed.data.client_user_ids) {
      const created = await createAssessmentFromTemplate(id, clientUserId, session.user.id)
      ids.push(created.id)
    }

    return NextResponse.json({ created: ids.length, ids }, { status: 201 })
  } catch (error) {
    console.error("Assign template error:", error)
    const msg = error instanceof Error && error.message === "Not a template" ? "Not a template" : "Failed to assign template"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
