// app/api/admin/newsletter/[id]/schedule/route.ts
// POST { scheduled_at: ISO } — arms a newsletter for automatic sending.
// The contentScheduleCron picks it up when scheduled_at <= now.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"
import { validateScheduleRequest } from "@/lib/content-schedule/validate"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const validated = await validateScheduleRequest(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status })
  }

  const { id } = await params
  const newsletter = await getNewsletterById(id)
  if (newsletter.status === "sent") {
    return NextResponse.json({ error: "This newsletter has already gone out." }, { status: 409 })
  }

  // Checked now rather than left for the scheduler to discover at 7am — the
  // runner re-checks this again at fire time because a scheduled newsletter
  // stays editable, so the two checks are deliberate, not redundant.
  if (!newsletter.content || newsletter.content.length < 10) {
    return NextResponse.json(
      { error: "This newsletter needs more text before it can be scheduled." },
      { status: 400 },
    )
  }

  const updated = await updateNewsletter(id, {
    status: "scheduled",
    scheduled_at: validated.scheduledAt.toISOString(),
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "newsletter.scheduled",
    category: "marketing",
    target: { type: "newsletter", id },
    request,
    metadata: { scheduled_at: validated.scheduledAt.toISOString() },
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    scheduled_at: updated.scheduled_at,
  })
}
