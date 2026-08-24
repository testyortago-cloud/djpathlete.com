// GET /api/admin/quizzes — the quizzes list as data.
//
// Admin only, 404 rather than 403: the route does not confirm what exists to
// a stranger. Same gate shape as the funnel preview routes.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getQuizAttemptCounts, listQuizzes } from "@/lib/db/quizzes"

export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const [quizzes, counts] = await Promise.all([
    listQuizzes(),
    getQuizAttemptCounts().catch(() => ({}) as Awaited<ReturnType<typeof getQuizAttemptCounts>>),
  ])

  return NextResponse.json({
    quizzes: quizzes.map((quiz) => ({ ...quiz, attempts: counts[quiz.id] ?? { total: 0, completed: 0 } })),
  })
}
