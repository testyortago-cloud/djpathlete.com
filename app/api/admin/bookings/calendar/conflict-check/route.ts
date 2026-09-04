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
//
// AUDITED AS `compliance`, BECAUSE THE ROW IS THE ONLY EVIDENCE. The column
// holds one timestamp, which the next tick overwrites and the next untick
// erases — so without an audit trail there is nothing afterwards to say the
// attestation was ever made, or when it was withdrawn. That is the difference
// between this and the two admin_write slugs next to it.

import { NextResponse } from "next/server"
import { z } from "zod"

import { withAudit } from "@/lib/audit/with-audit"
import { confirmCoachCalendarConflictCheck } from "@/lib/db/coach-calendar-connections"
import { requireCalendarConnection } from "../connection"

const bodySchema = z.object({ confirmed: z.boolean() })

export const POST = withAudit(
  { action: "calendar.conflict_check_confirmed", category: "compliance" },
  async (request) => {
    const ctx = await requireCalendarConnection(request)
    if ("response" in ctx) return ctx.response

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Say whether you have checked the setting." }, { status: 400 })
    }

    await confirmCoachCalendarConflictCheck(ctx.connection.id, parsed.data.confirmed)

    return NextResponse.json({ ok: true, confirmed: parsed.data.confirmed })
  },
)
