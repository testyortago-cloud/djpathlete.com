import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { trainingSessionFormSchema } from "@/lib/validators/training-session"
import { upsert, listByUser } from "@/lib/db/training-sessions"
import { runEvaluation } from "@/lib/coach-intel/run-evaluation"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const sessions = await listByUser(clientUserId)
  return NextResponse.json({ sessions })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = await req.json()
  const parsed = trainingSessionFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const clientUserId =
    session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id

  const result = await upsert(clientUserId, parsed.data)

  try {
    await runEvaluation(clientUserId, parsed.data.date)
  } catch (e) {
    console.error("[training-sessions] runEvaluation failed", e)
  }

  return NextResponse.json({ session: result })
}
