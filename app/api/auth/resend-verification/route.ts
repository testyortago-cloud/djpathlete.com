import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserById } from "@/lib/db/users"
import { createEmailVerificationToken } from "@/lib/db/email-verification-tokens"
import { sendVerificationEmail } from "@/lib/email"

const resendSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = resendSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { userId } = result.data

    const user = await getUserById(userId)

    if (!user) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 }
      )
    }

    if (user.email_verified) {
      return NextResponse.json(
        { error: "Email is already verified." },
        { status: 400 }
      )
    }

    const token = await createEmailVerificationToken(userId)
    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`
    await sendVerificationEmail(user.email, verifyUrl, user.first_name)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Resend verification error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    )
  }
}
