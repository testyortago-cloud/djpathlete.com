import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminExerciseFavoriteSchema } from "@/lib/validators/exercise-favorite"
import { addFavorite, removeFavorite } from "@/lib/db/exercise-favorites"
import { recordAudit } from "@/lib/audit/record"

async function requireAdmin() {
  const session = await auth()
  const role = session?.user?.role as string | undefined
  const adminId = session?.user?.id as string | undefined
  if (role !== "admin" || !adminId) return null
  return adminId
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id: clientUserId } = await params

  const parsed = adminExerciseFavoriteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  try {
    await addFavorite(clientUserId, parsed.data.exerciseId, { createdBy: adminId, source: "admin" })
  } catch {
    return NextResponse.json({ error: "Could not add favorite" }, { status: 500 })
  }

  recordAudit({
    action: "exercise_favorite.added",
    category: "admin_write",
    target: { type: "user", id: clientUserId },
    metadata: { exercise_id: parsed.data.exerciseId, client_user_id: clientUserId, source: "admin" },
    actor: { id: adminId, role: "admin" },
    request,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id: clientUserId } = await params

  const parsed = adminExerciseFavoriteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  try {
    await removeFavorite(clientUserId, parsed.data.exerciseId)
  } catch {
    return NextResponse.json({ error: "Could not remove favorite" }, { status: 500 })
  }

  recordAudit({
    action: "exercise_favorite.removed",
    category: "admin_write",
    target: { type: "user", id: clientUserId },
    metadata: { exercise_id: parsed.data.exerciseId, client_user_id: clientUserId, source: "admin" },
    actor: { id: adminId, role: "admin" },
    request,
  })
  return NextResponse.json({ ok: true })
}
