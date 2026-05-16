import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readinessFormSchema } from "@/lib/validators/daily-readiness"
import { upsert } from "@/lib/db/daily-readiness"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"
import { checkGoals } from "@/lib/coach-intel/check-goals"
import { recordAudit } from "@/lib/audit/record"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = readinessFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }

  const { date, ...rest } = parsed.data
  const targetUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id

  const result = await upsert(targetUserId, date, rest)

  try {
    await runEvaluation(targetUserId, date)
  } catch (e) {
    console.error("[readiness] runEvaluation failed", e)
  }

  try {
    await checkGoals(targetUserId, { readinessScore: result.readiness_score })
  } catch (e) {
    console.error("[readiness] checkGoals failed", e)
  }

  await recordAudit({
    action: "readiness.submitted",
    category: "client_action",
    target: { type: "daily_readiness", id: result.id },
    metadata: {
      score: result.readiness_score,
      sleep_hours: result.sleep_hours,
      stress_level: parsed.data.stress,
      date,
    },
    request: req,
  })

  return NextResponse.json({ readiness: result })
}
