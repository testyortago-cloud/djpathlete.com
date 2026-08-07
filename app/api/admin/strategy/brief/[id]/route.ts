import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { patchDraftBrief } from "@/lib/db/strategy-briefs"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!(await canAccessAdminPath(session?.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = createServiceRoleClient()
  const { data } = await sb.from("strategy_briefs").select("*").eq("id", id).maybeSingle()
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ brief: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!(await canAccessAdminPath(session?.user))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 })
  const sb = createServiceRoleClient()
  try {
    const updated = await patchDraftBrief(sb, id, body as never)
    return NextResponse.json({ brief: updated })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 })
  }
}
