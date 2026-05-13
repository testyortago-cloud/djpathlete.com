import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTestHistory } from "@/lib/db/performance-tests"
import { TEST_TYPES } from "@/lib/validators/performance-test"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; testType: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, testType } = await params
  if (session.user.role !== "admin" && session.user.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  if (!(TEST_TYPES as readonly string[]).includes(testType)) {
    return NextResponse.json({ error: "bad_test_type" }, { status: 400 })
  }
  const history = await getTestHistory(id, testType as (typeof TEST_TYPES)[number])
  return NextResponse.json({ history })
}
