import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"
import { getUserById } from "@/lib/db/users"
import { sendProgramAvailableForPurchaseEmail } from "@/lib/email"

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

    const data = result.data

    // Targeted programs must be private
    if (data.target_user_id) {
      data.is_public = false
    }

    const program = await createProgram({
      ...data,
      is_active: true,
      created_by: session?.user?.id ?? null,
      is_ai_generated: false,
      ai_generation_params: null,
    })

    // Notify targeted client (non-blocking)
    if (data.target_user_id && data.price_cents) {
      getUserById(data.target_user_id)
        .then((user) =>
          sendProgramAvailableForPurchaseEmail(
            user.email,
            user.first_name,
            program.name,
            program.id,
            user.id
          )
        )
        .catch((err) =>
          console.error("[API programs POST] Failed to send notification:", err)
        )
    }

    return NextResponse.json(program, { status: 201 })
  } catch (err) {
    console.error("[API programs POST] Error:", err)
    return NextResponse.json(
      { error: "Failed to create program. Please try again." },
      { status: 500 }
    )
  }
}
