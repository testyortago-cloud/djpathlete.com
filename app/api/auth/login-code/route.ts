import { NextResponse } from "next/server"
import { z } from "zod"
import { getUserByEmail } from "@/lib/db/users"
import { issueLoginCode } from "@/lib/db/login-codes"
import { sendLoginCodeEmail } from "@/lib/email"
import { recordAudit } from "@/lib/audit/record"

const schema = z.object({ email: z.string().trim().email() })

// Emails a 6-digit sign-in code. Answers the same 200 whether or not the
// account exists, is eligible, or is inside a cooldown, so the form cannot be
// used to find out who has an account.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
  }
  const { email } = parsed.data

  try {
    const user = await getUserByEmail(email)
    // Same eligibility as the password form: a lead with no password needs the coach's invite.
    const result = user?.password_hash ? await issueLoginCode(user.id) : null
    if (user && result?.status === "issued") {
      await sendLoginCodeEmail(user.email, result.code, user.first_name)
    }

    await recordAudit({
      action: "auth.login_code_request",
      category: "auth",
      outcome: result?.status === "issued" ? "success" : "failure",
      actor: { id: user?.id ?? null, email, role: "anonymous" },
      request,
      metadata: { result: !user ? "user_not_found" : (result?.status ?? "lead_no_password") },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[login-code] failed:", error)
    return NextResponse.json(
      { error: "We couldn't send a code right now. Please try again in a minute." },
      { status: 500 },
    )
  }
}
