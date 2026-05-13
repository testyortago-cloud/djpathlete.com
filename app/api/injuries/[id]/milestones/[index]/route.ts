import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { z } from "zod"
import { completeMilestone, getById } from "@/lib/db/injuries"

const patchSchema = z.object({
  completed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, index } = await params
  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0) {
    return NextResponse.json({ error: "bad_index" }, { status: 400 })
  }
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const injury = await completeMilestone(
    id,
    idx,
    parsed.data.completed_date,
    parsed.data.notes ?? undefined,
  )
  return NextResponse.json({ injury })
}
