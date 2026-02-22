import { NextResponse } from "next/server"
import { programFormSchema } from "@/lib/validators/program"
import { updateProgram, deleteProgram, getProgramById } from "@/lib/db/programs"
import { getUserById } from "@/lib/db/users"
import { sendProgramAvailableForPurchaseEmail } from "@/lib/email"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = programFormSchema.safeParse(body)

    if (!result.success) {
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

    // Check if target_user_id changed to a new user
    const existing = await getProgramById(id)
    const targetChanged =
      data.target_user_id &&
      data.target_user_id !== existing.target_user_id

    const program = await updateProgram(id, data)

    // Notify newly targeted client (non-blocking)
    if (targetChanged && data.target_user_id && data.price_cents) {
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
          console.error("[API programs PATCH] Failed to send notification:", err)
        )
    }

    return NextResponse.json(program)
  } catch {
    return NextResponse.json(
      { error: "Failed to update program. Please try again." },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteProgram(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete program. Please try again." },
      { status: 500 }
    )
  }
}
