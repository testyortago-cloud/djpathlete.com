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

  // Same 404-not-403 posture as the rest of this route: the allowed set can
  // still come back empty (e.g. zero businesses exist yet), and this route
  // does not confirm what exists to anyone, including an admin session with
  // nothing to resolve.
  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Not found." }, { status: 404 })
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
