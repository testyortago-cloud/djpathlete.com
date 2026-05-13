import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readinessFormSchema } from "@/lib/validators/daily-readiness"
import { upsert } from "@/lib/db/daily-readiness"

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
  return NextResponse.json({ readiness: result })
}
