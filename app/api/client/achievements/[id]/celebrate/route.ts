import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { markCelebrated } from "@/lib/db/achievements"
import { celebrateAchievementSchema } from "@/lib/validators/achievement"

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const parsed = celebrateAchievementSchema.safeParse({ id })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid achievement ID", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    await markCelebrated(parsed.data.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Celebrate achievement PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to mark achievement as celebrated" },
      { status: 500 }
    )
  }
}
