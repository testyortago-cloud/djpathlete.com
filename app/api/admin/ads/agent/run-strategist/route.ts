// app/api/admin/ads/agent/run-strategist/route.ts
// Admin "Generate now" — builds a fresh strategist memo on demand and
// persists it. Doesn't send the email (the user is already at the dashboard).

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildStrategistMemo } from "@/lib/ads/agent"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const memo = await buildStrategistMemo({
      source: "manual",
      triggered_by: session.user.id,
    })
    return NextResponse.json({ ok: true, id: memo.id })
  } catch (error) {
    console.error("[agent/run-strategist] failed:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "generate failed" },
      { status: 500 },
    )
  }
}
