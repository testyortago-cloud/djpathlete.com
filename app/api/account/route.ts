import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateUser, getUserByEmail } from "@/lib/db/users"
import { z } from "zod"

const updateAccountSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(50),
  last_name: z.string().min(1, "Last name is required").max(50),
  email: z.string().email("Invalid email address"),
})

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = updateAccountSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const { first_name, last_name, email } = parsed.data

    // If email is changing, check it's not already taken
    if (email !== session.user.email) {
      const existing = await getUserByEmail(email)
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ error: "Email is already in use" }, { status: 409 })
      }
    }

    const updated = await updateUser(session.user.id, {
      first_name,
      last_name,
      email,
    })

    return NextResponse.json({
      user: {
        id: updated.id,
        first_name: updated.first_name,
        last_name: updated.last_name,
        email: updated.email,
      },
    })
  } catch (error) {
    console.error("Account update error:", error)
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
  }
}
