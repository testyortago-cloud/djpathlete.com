// POST /api/admin/funnels/ai/interview — step 1 of Ask AI.
//
// Takes one sentence, returns the questions worth asking about it. Stores
// nothing: the questions travel back to the client and return with their
// answers on the next call, so there is no session, no table and no cleanup.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { interviewQuestions, BRIEF_MAX_LENGTH, type CreateKind } from "@/lib/ai/funnel-interview"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as
    | { brief?: unknown; kind?: unknown }
    | null
  const brief = typeof body?.brief === "string" ? body.brief.trim() : ""
  if (brief.length < 3) {
    return NextResponse.json({ error: "Tell me what you want to build first." }, { status: 400 })
  }

  try {
    // Defaults to "funnel" so the documented one-field body keeps working.
    const kind: CreateKind = body?.kind === "page" ? "page" : "funnel"
    const questions = await interviewQuestions(brief.slice(0, BRIEF_MAX_LENGTH), kind)
    return NextResponse.json({ questions })
  } catch (error) {
    // A model failure costs the owner the assist, never the dialog — the client
    // shows this and they carry on filling it in themselves.
    console.error("[funnels/ai/interview]", error)
    return NextResponse.json({ error: "Could not think of questions just now." }, { status: 502 })
  }
}
