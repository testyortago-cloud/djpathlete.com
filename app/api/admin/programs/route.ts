import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"

export async function POST(request: Request) {
  try {
    const session = await auth()
    const body = await request.json()

    const result = programFormSchema.safeParse(body)

    if (!result.success) {
      console.error("[API programs POST] Validation failed:", result.error.flatten().fieldErrors)
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const program = await createProgram({
      ...result.data,
      is_active: true,
      created_by: session?.user?.id ?? null,
      is_ai_generated: false,
      ai_generation_params: null,
    })

    return NextResponse.json(program, { status: 201 })
  } catch (err) {
    console.error("[API programs POST] Error:", err)
    return NextResponse.json(
      { error: "Failed to create program. Please try again." },
      { status: 500 }
    )
  }
}
