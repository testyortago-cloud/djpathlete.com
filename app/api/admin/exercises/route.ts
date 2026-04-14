import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { exerciseFormSchema } from "@/lib/validators/exercise"
import { createExercise, getExercises } from "@/lib/db/exercises"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") ?? ""

    const exercises = await getExercises()

    if (search) {
      const lower = search.toLowerCase()
      const filtered = exercises.filter(
        (ex) => ex.name.toLowerCase().includes(lower) || (ex.muscle_group?.toLowerCase().includes(lower) ?? false),
      )
      return NextResponse.json(filtered)
    }

    return NextResponse.json(exercises)
  } catch {
    return NextResponse.json({ error: "Failed to fetch exercises." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = exerciseFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const exercise = await createExercise({
      ...result.data,
      is_active: true,
      created_by: null,
      thumbnail_url: null,
    })

    return NextResponse.json(exercise, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create exercise. Please try again." }, { status: 500 })
  }
}
