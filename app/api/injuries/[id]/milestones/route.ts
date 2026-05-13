import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { rehabMilestoneSchema } from "@/lib/validators/injury"
import { addMilestone, getById } from "@/lib/db/injuries"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const parsed = rehabMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
  }
  const existing = await getById(id)
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (session.user.role !== "admin" && existing.client_user_id !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const injury = await addMilestone(id, parsed.data)
  return NextResponse.json({ injury })
}
