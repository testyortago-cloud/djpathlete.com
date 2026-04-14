import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProfilesWithQuestionnaire } from "@/lib/db/client-profiles"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profiles = await getProfilesWithQuestionnaire()
    return NextResponse.json({ profiles })
  } catch (error) {
    console.error("Admin questionnaires GET error:", error)
    return NextResponse.json({ error: "Failed to fetch questionnaires" }, { status: 500 })
  }
}
