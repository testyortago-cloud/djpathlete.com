import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserByEmail } from "@/lib/db/users"
import { createPasswordResetToken } from "@/lib/db/password-reset-tokens"
import { sendPasswordResetEmail } from "@/lib/email"

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = forgotPasswordSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      )
    }

    const { email } = result.data
    const user = await getUserByEmail(email)

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({ success: true })
    }

    const token = await createPasswordResetToken(user.id)

    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const resetUrl = `${baseUrl}/reset-password?token=${token}`

    await sendPasswordResetEmail(user.email, resetUrl, user.first_name)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Forgot password error:", error)
    // Still return success to prevent email enumeration
    return NextResponse.json({ success: true })
  }
}
