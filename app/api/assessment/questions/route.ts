import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getActiveQuestions } from "@/lib/db/assessments"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const questions = await getActiveQuestions()
    return NextResponse.json(questions)
  } catch {
    return NextResponse.json({ error: "Failed to fetch assessment questions." }, { status: 500 })
  }
}
