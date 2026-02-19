import { NextResponse } from "next/server"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = programFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const program = await createProgram({
      ...result.data,
      is_active: true,
      created_by: null,
    })

    return NextResponse.json(program, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Failed to create program. Please try again." },
      { status: 500 }
    )
  }
}
