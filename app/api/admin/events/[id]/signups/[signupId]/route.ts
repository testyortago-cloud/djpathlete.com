import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSignupById, confirmSignup, cancelSignup } from "@/lib/db/event-signups"
import { getEventById } from "@/lib/db/events"
import { sendEventSignupConfirmedEmail } from "@/lib/email"

type Action = "confirm" | "cancel"

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; signupId: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id, signupId } = await ctx.params
    const body = (await request.json()) as { action?: Action }
    if (body.action !== "confirm" && body.action !== "cancel") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    const signup = await getSignupById(signupId)
    if (!signup || signup.event_id !== id) {
      return NextResponse.json({ error: "Signup not found" }, { status: 404 })
    }

    if (body.action === "confirm") {
      const result = await confirmSignup(signupId)
      if (!result.ok) {
        const status = result.reason === "not_found" ? 404 : 409
        const message =
          result.reason === "not_pending"
            ? "Signup is already confirmed or cancelled"
            : result.reason === "at_capacity"
              ? "Event is at capacity — cannot confirm more signups"
              : "Signup not found"
        return NextResponse.json({ error: message, reason: result.reason }, { status })
      }

      const updated = await getSignupById(signupId)
      const event = await getEventById(id)
      if (updated && event) {
        try {
          await sendEventSignupConfirmedEmail(updated, event)
        } catch (err) {
          console.error(`[admin confirm] email failed for signup ${signupId}`, err)
        }
      }
      return NextResponse.json({ signup: updated })
    }

    // action === "cancel"
    const result = await cancelSignup(signupId)
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409
      const message =
        result.reason === "not_cancellable"
          ? "Signup cannot be cancelled from its current state"
          : "Signup not found"
      return NextResponse.json({ error: message, reason: result.reason }, { status })
    }

    const updated = await getSignupById(signupId)
    return NextResponse.json({ signup: updated })
  } catch (err) {
    console.error("[api admin signups PATCH]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
