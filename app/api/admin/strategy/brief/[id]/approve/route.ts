import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { approveBrief } from "@/lib/db/strategy-briefs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createServiceRoleClient()
  const brief = await approveBrief(sb, id, session.user.id)
  return NextResponse.json({ brief })
}
