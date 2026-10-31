import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getClientQuizResult } from "@/lib/quizzes/client-result"

/** The client's own quiz result a new AI program will use, for the AI Generate dialog. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }
  try {
    const { id } = await params
    const { businessId } = await resolveAdminTenantForRequest(request)
    const result = await getClientQuizResult(businessId, id)
    return NextResponse.json({ result: result && { quizName: result.quizName, completedAt: result.completedAt } })
  } catch (error) {
    console.error("[self-assessment GET]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Could not read the client's self-assessment." }, { status: 500 })
  }
}
