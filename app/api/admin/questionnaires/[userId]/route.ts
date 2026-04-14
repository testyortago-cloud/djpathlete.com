import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProfileByUserId } from "@/lib/db/client-profiles"

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { userId } = await params

    const profile = await getProfileByUserId(userId)
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error("Admin questionnaire detail GET error:", error)
    return NextResponse.json({ error: "Failed to fetch questionnaire" }, { status: 500 })
  }
}
