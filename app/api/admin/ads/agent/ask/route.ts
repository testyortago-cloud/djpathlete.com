// app/api/admin/ads/agent/ask/route.ts
// Admin-only ad-hoc Q&A. Loads the snapshot, asks Claude, returns the
// markdown answer. No streaming for v1 — the snapshot fits in one prompt
// and answers are short.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { askAgent } from "@/lib/ads/agent"

const BodySchema = z.object({ question: z.string().min(1).max(2000) })

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const raw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "question is required" }, { status: 400 })
  }
  try {
    const { answer, tokens_used } = await askAgent(parsed.data.question)
    return NextResponse.json({ ok: true, answer, tokens_used })
  } catch (error) {
    console.error("[agent/ask] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "ask failed" },
      { status: 500 },
    )
  }
}
