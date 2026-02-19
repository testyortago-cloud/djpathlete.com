import { NextResponse } from "next/server"
import { z } from "zod"
import { hash } from "bcryptjs"
import { validatePasswordResetToken, markTokenUsed } from "@/lib/db/password-reset-tokens"
import { updateUser } from "@/lib/db/users"

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = resetPasswordSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { token, password } = result.data

    const tokenData = await validatePasswordResetToken(token)
    if (!tokenData) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Please request a new one." },
        { status: 400 }
      )
    }

    const passwordHash = await hash(password, 12)
    await updateUser(tokenData.user_id, { password_hash: passwordHash })
    await markTokenUsed(token)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Reset password error:", error)
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 }
    )
  }
}
