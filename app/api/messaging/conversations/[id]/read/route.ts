// POST /api/messaging/conversations/[id]/read — stamp the caller's side
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { markRead } from "@/lib/db/conversations"

export const runtime = "nodejs"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const participant = await resolveParticipant(session, id)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Only the caller's side is stamped. Writing both would mark the coach's
  // messages read the moment the client opened the thread, and the delayed
  // email leans on these timestamps being honest.
  const readAt = await markRead(id, participant.role)
  return NextResponse.json({ read_at: readAt, side: participant.role })
}
