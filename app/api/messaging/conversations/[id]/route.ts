// GET /api/messaging/conversations/[id] — one thread
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { listMessages, THREAD_PAGE_SIZE } from "@/lib/db/messages"

export const runtime = "nodejs"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const participant = await resolveParticipant(session, id)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const before = request.nextUrl.searchParams.get("before") ?? undefined
  const messages = await listMessages(id, THREAD_PAGE_SIZE, before)

  return NextResponse.json({
    conversation: participant.conversation,
    messages,
    participant_role: participant.role,
    has_more: messages.length === THREAD_PAGE_SIZE,
  })
}
