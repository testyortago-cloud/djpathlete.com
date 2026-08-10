// app/api/admin/funnels/leads/[id]/route.ts — working one captured lead.
//
// Two mutations, one route: move the follow-up status, and write a note. Both
// are audited, because "who marked this lead contacted and when" is exactly the
// kind of question the audit trail exists to answer, and both touch a row that
// holds a real person's name, email and phone.
//
// The status and the note are audited under DIFFERENT slugs even though they
// arrive on the same request. A status change is a claim about the business
// ("this lead converted"); a note is a private annotation. Collapsing them into
// one `funnel.lead_updated` would make the trail unable to answer either
// question without opening the metadata.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { getLead, setLeadNotes, setLeadStatus } from "@/lib/db/funnel-leads"
import { FUNNEL_LEAD_STATUSES } from "@/types/database"

/**
 * ASKS THE TYPE, DOES NOT RESTATE IT. `FUNNEL_LEAD_STATUSES` is the same array
 * the UI renders its dropdown from and mirrors the CHECK constraint in 00204.
 * A fourth status added to the workflow must not be accepted here while the
 * database rejects it, and must not be rejected here while the database allows
 * it — this repo has shipped that disagreement before by hand-typing a union in
 * a guard.
 */
const patchSchema = z
  .object({
    status: z.enum(FUNNEL_LEAD_STATUSES as unknown as [string, ...string[]]).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((value) => value.status !== undefined || value.notes !== undefined, {
    message: "Send a status, a note, or both.",
  })

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await ctx.params

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    const before = await getLead(id)
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let lead = before

    if (parsed.data.status !== undefined) {
      lead = await setLeadStatus(id, parsed.data.status as typeof before.status)
      recordAudit({
        action: "funnel.lead_status_changed",
        category: "admin_write",
        outcome: "success",
        target: { type: "funnel_submission", id },
        metadata: { from: before.status, to: lead.status, funnel_id: lead.funnel_id },
      })
    }

    if (parsed.data.notes !== undefined) {
      lead = await setLeadNotes(id, parsed.data.notes)
      recordAudit({
        action: "funnel.lead_note_written",
        category: "admin_write",
        outcome: "success",
        target: { type: "funnel_submission", id },
        // The note's TEXT is deliberately not in the metadata. It is free-form
        // coach commentary about a named person, the audit table is queried far
        // more widely than the leads screen, and `metadata` is capped at 8KB
        // anyway. Its length is enough to show something was written.
        metadata: { funnel_id: lead.funnel_id, length: lead.notes?.length ?? 0 },
      })
    }

    return NextResponse.json({ lead })
  } catch (error) {
    console.error("[PATCH /api/admin/funnels/leads/:id]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
