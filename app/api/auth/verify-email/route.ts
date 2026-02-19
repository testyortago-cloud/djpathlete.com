import { NextResponse } from "next/server"
import { z } from "zod"
import { validateEmailVerificationToken, markVerificationTokenUsed } from "@/lib/db/email-verification-tokens"
import { updateUser } from "@/lib/db/users"

const verifySchema = z.object({
  token: z.string().min(1, "Token is required"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = verifySchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { token } = result.data

    const tokenData = await validateEmailVerificationToken(token)

    if (!tokenData) {
      return NextResponse.json(
        { error: "Invalid or expired verification link. Please request a new one." },
        { status: 400 }
      )
    }

    // Mark user as verified
    const user = tokenData.users as { id: string; email: string; first_name: string }
    await updateUser(user.id, { email_verified: true } as Parameters<typeof updateUser>[1])

    // Mark token as used
    await markVerificationTokenUsed(token)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Email verification error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    )
  }
}
