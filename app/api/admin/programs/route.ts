import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"
import { createAssignment } from "@/lib/db/assignments"
import { getUserById } from "@/lib/db/users"
import { sendProgramReadyEmail } from "@/lib/email"

export async function POST(request: Request) {
  try {
    const session = await auth()
    const body = await request.json()
    console.log("[API programs POST] Body received:", JSON.stringify(body))

    // Extract assign_to before schema validation (it's not part of the program schema)
    const assignTo = typeof body.assign_to === "string" && body.assign_to ? body.assign_to : null

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

    // Auto-assign to client if specified
    if (assignTo) {
      try {
        await createAssignment({
          program_id: program.id,
          user_id: assignTo,
          assigned_by: session?.user?.id ?? null,
          start_date: new Date().toISOString().split("T")[0],
          end_date: null,
          status: "active",
          notes: null,
        })

        // Send notification email
        try {
          const client = await getUserById(assignTo)
          await sendProgramReadyEmail(client.email, client.first_name, program.name)
        } catch (emailError) {
          console.error("[API programs POST] Failed to send email:", emailError)
        }
      } catch (assignError) {
        console.error("[API programs POST] Failed to assign program:", assignError)
      }
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
