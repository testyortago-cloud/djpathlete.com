import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { performanceTestFormSchema } from "@/lib/validators/performance-test"
import { create, listByUser } from "@/lib/db/performance-tests"
import { checkGoals } from "@/lib/coach-intel/check-goals"
import type { TestType } from "@/types/database"
import { withAudit } from "@/lib/audit/with-audit"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const testType = url.searchParams.get("test_type") as TestType | null
  const tests = await listByUser(clientUserId, testType ? { testType } : {})
  return NextResponse.json({ tests })
}

export const POST = withAudit(
  { action: "performance_test.submitted", category: "client_action" },
  async (req: Request) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const body = await req.json()
    const parsed = performanceTestFormSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
    }
    const clientUserId =
      session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id
    const test = await create(clientUserId, parsed.data, session.user.id)

    try {
      await checkGoals(clientUserId, {
        testType: test.test_type,
        testValue: test.result_value,
      })
    } catch (e) {
      console.error("[performance-tests] checkGoals failed", e)
    }

    return NextResponse.json({ test })
  },
)
