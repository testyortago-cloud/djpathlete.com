import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { rejectBrief } from "@/lib/db/strategy-briefs"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createServiceRoleClient()
  const brief = await rejectBrief(sb, id, session.user.id)
  return NextResponse.json({ brief })
}
