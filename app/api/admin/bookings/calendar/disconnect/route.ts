// app/api/admin/bookings/calendar/disconnect/route.ts
//
// THE ORDER IS THE WHOLE DESIGN. The Calendly subscription goes first, the
// vault secret second, because deleting the subscription REQUIRES the
// credentials. Reverse them and a failure in between leaves a live
// subscription we can no longer authenticate against — Calendly keeps posting
// bookings at a connection that has nothing left to file them under, and only
// the coach, inside Calendly's own UI, can stop it.
//
// So a subscription delete that genuinely fails stops the disconnect and says
// so. The coach's credentials are still there; pressing Disconnect again
// retries the whole thing.
//
// A 404 IS NOT A FAILURE. `deleteWebhookSubscription` treats already-gone as
// success (see its docstring): the desired end state is "that subscription
// does not exist", and it does not.

import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/with-audit"
import { deleteWebhookSubscription } from "@/lib/calendly/account"
import { accessTokenForConnection } from "@/lib/calendly/credentials"
import { disconnectCoachCalendar } from "@/lib/db/coach-calendar-connections"
import { requireCalendarConnection } from "../connection"

export const POST = withAudit({ action: "calendar.disconnected", category: "admin_write" }, async (request) => {
  const ctx = await requireCalendarConnection(request)
  if ("response" in ctx) return ctx.response

  const { connection, hostId } = ctx

  if (connection.webhook_subscription_uri) {
    try {
      const accessToken = await accessTokenForConnection(connection)
      await deleteWebhookSubscription({
        accessToken,
        subscriptionUri: connection.webhook_subscription_uri,
      })
    } catch (err) {
      // Deliberately fatal. See the header: the credentials must survive
      // this so the retry can authenticate.
      console.error("[calendar/disconnect] could not remove the Calendly subscription", err)
      return NextResponse.json(
        {
          error:
            "We could not tell Calendly to stop sending bookings, so nothing was disconnected. Try again in a moment.",
        },
        { status: 502 },
      )
    }
  }

  await disconnectCoachCalendar(hostId)

  return NextResponse.json({ ok: true })
})
