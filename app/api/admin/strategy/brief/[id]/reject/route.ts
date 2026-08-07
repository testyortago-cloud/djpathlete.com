import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { rejectBrief } from "@/lib/db/strategy-briefs"
import { markBriefRejected } from "@/lib/db/chief-strategist-memos"
import { canAccessAdminPath } from "@/lib/permissions/guard"

const bodySchema = z.object({ reason: z.string().optional() }).optional()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createServiceRoleClient()
  const brief = await rejectBrief(sb, id, session.user.id)

  const rawBody = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(rawBody)
  const reason = (parsed.success ? parsed.data?.reason : undefined) ?? "rejected_via_admin_ui"

  try {
    await markBriefRejected(sb, id, reason)
  } catch (e) {
    console.warn(`[reject-brief] markBriefRejected non-fatal:`, e)
  }

  return NextResponse.json({ brief })
}
