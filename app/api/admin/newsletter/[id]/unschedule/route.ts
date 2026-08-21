// app/api/admin/newsletter/[id]/unschedule/route.ts
// POST — takes a scheduled newsletter back to draft and clears its time.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const newsletter = await getNewsletterById(id)
  if (newsletter.status !== "scheduled") {
    return NextResponse.json({ error: "That newsletter is not scheduled." }, { status: 409 })
  }

  const updated = await updateNewsletter(id, {
    status: "draft",
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  await recordAudit({
    action: "newsletter.schedule_cancelled",
    category: "marketing",
    target: { type: "newsletter", id },
    request,
  })

  return NextResponse.json({ id: updated.id, status: updated.status, scheduled_at: null })
}
