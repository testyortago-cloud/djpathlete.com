// GET /api/admin/quizzes — the quizzes list as data.
//
// Admin only, 404 rather than 403: the route does not confirm what exists to
// a stranger. Same gate shape as the funnel preview routes.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getQuizAttemptCounts, listQuizzes } from "@/lib/db/quizzes"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // `NoAccessibleBusinessError` is about the CALLER having no business at
  // all -- not about a resource this route is declining to confirm -- so it
  // gets the majority 403 {"error":"Forbidden"} shape (businesses, funnels
  // routes), not the 404-not-403 posture the rest of this route uses.
  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  const [quizzes, counts] = await Promise.all([
    listQuizzes(businessId),
    getQuizAttemptCounts(businessId).catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
  ])

  return NextResponse.json({
    quizzes: quizzes.map((quiz) => ({ ...quiz, attempts: counts[quiz.id] ?? { total: 0, completed: 0 } })),
  })
}
