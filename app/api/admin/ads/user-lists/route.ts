// app/api/admin/ads/user-lists/route.ts
// Admin upsert / delete for the Customer Match list config (one per
// audience_type per customer). DELETE accepts ?id=...

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { deleteUserList, upsertUserList } from "@/lib/db/google-ads-user-lists"

const UpsertSchema = z.object({
  customer_id: z.string().min(1),
  user_list_id: z.string().min(1),
  name: z.string().min(1).max(120),
  audience_type: z.enum(["bookers", "subscribers", "icp"]),
  is_active: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const raw = await request.json().catch(() => null)
  const parsed = UpsertSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  try {
    const list = await upsertUserList(parsed.data)
    return NextResponse.json({ ok: true, list })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "upsert failed" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const id = request.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  try {
    await deleteUserList(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "delete failed" },
      { status: 500 },
    )
  }
}
