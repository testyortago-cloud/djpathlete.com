import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getAchievements,
  getAchievementsByType,
  getUncelebratedAchievements,
} from "@/lib/db/achievements"
import type { AchievementType } from "@/types/database"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") as AchievementType | null
    const uncelebrated = searchParams.get("uncelebrated")

    // If uncelebrated flag is set, return only uncelebrated achievements
    if (uncelebrated === "true") {
      const achievements = await getUncelebratedAchievements(session.user.id)
      return NextResponse.json(achievements)
    }

    // If type filter is provided, filter by achievement type
    if (type) {
      const validTypes: AchievementType[] = ["pr", "streak", "milestone", "completion"]
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { error: "Invalid achievement type" },
          { status: 400 }
        )
      }
      const achievements = await getAchievementsByType(session.user.id, type)
      return NextResponse.json(achievements)
    }

    // Default: return all achievements
    const achievements = await getAchievements(session.user.id)
    return NextResponse.json(achievements)
  } catch (error) {
    console.error("Achievements GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch achievements" },
      { status: 500 }
    )
  }
}
