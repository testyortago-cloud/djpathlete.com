import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { exerciseFavoriteToggleSchema } from "@/lib/validators/exercise-favorite"
import { addFavorite, removeFavorite } from "@/lib/db/exercise-favorites"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  const session = await auth()
  const userId = session?.user?.id as string | undefined
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = exerciseFavoriteToggleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const { exerciseId, favorited } = parsed.data
  try {
    if (favorited) {
      await addFavorite(userId, exerciseId, { createdBy: userId, source: "client" })
    } else {
      await removeFavorite(userId, exerciseId)
    }
  } catch {
    return NextResponse.json({ error: "Could not update favorite" }, { status: 500 })
  }

  recordAudit({
    action: favorited ? "exercise_favorite.added" : "exercise_favorite.removed",
    category: "client_action",
    target: { type: "exercise", id: exerciseId },
    metadata: { exercise_id: exerciseId, client_user_id: userId, source: "client" },
    request,
  })

  return NextResponse.json({ ok: true, favorited })
}
