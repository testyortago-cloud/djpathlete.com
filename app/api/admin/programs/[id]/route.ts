import { NextResponse } from "next/server"
import { programFormSchema } from "@/lib/validators/program"
import { updateProgram, deleteProgram } from "@/lib/db/programs"

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

    const program = await updateProgram(id, result.data)
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
