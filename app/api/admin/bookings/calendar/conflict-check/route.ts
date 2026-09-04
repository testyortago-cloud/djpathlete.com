// app/api/admin/bookings/calendar/conflict-check/route.ts
//
// The coach's own confirmation that "Check for conflicts" is switched on in
// their Calendly. No Calendly API exposes that setting, so the only evidence
// that exists is the coach saying so — which is why this is a stored
// timestamp and not a derived value.
//
// UNTICKING CLEARS IT RATHER THAN LEAVING THE OLD STAMP. A coach who changed
// their mind is telling us the confirmation no longer holds, and a stale
// "confirmed on 3 March" would keep the screen's warning badge hidden over a
// calendar that is now double-booking them.

import { NextResponse } from "next/server"
import { z } from "zod"

import { confirmCoachCalendarConflictCheck } from "@/lib/db/coach-calendar-connections"
import { requireCalendarConnection } from "../connection"

const bodySchema = z.object({ confirmed: z.boolean() })

export async function POST(request: Request) {
  const ctx = await requireCalendarConnection(request)
  if ("response" in ctx) return ctx.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Say whether you have checked the setting." }, { status: 400 })
  }

  await confirmCoachCalendarConflictCheck(ctx.connection.id, parsed.data.confirmed)

  return NextResponse.json({ ok: true, confirmed: parsed.data.confirmed })
}
