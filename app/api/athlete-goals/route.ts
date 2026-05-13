import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { athleteGoalFormSchema } from "@/lib/validators/athlete-goal"
import { create, listByUser } from "@/lib/db/athlete-goals"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const goals = await listByUser(clientUserId)
  return NextResponse.json({ goals })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = athleteGoalFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id
  const goal = await create(clientUserId, parsed.data)
  return NextResponse.json({ goal })
}
