import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateUser, getUserByEmail } from "@/lib/db/users"
import { z } from "zod"

const editClientSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(50),
  lastName: z.string().min(1, "Last name is required").max(50),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional().nullable(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized. Admin access required." },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const result = editClientSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { firstName, lastName, email, phone, status } = result.data

    // Check for duplicate email (excluding current user)
    const existing = await getUserByEmail(email)
    if (existing && existing.id !== id) {
      return NextResponse.json(
        { error: "Another user already has this email address." },
        { status: 409 }
      )
    }

    const updates: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
    }
    if (status) updates.status = status

    const user = await updateUser(id, updates)

    // Strip password_hash from response
    const { password_hash: _, ...safeUser } = user

    return NextResponse.json(safeUser)
  } catch (error) {
    console.error("Edit client error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    )
  }
}
