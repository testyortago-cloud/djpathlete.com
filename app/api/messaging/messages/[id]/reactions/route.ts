// POST /api/messaging/messages/[id]/reactions — toggle one emoji
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { isValidEmoji, MAX_REACTIONS_PER_USER } from "@/lib/messaging/reactions"
import { countReactionsByUser, getMessageConversationId, toggleReaction } from "@/lib/db/messages"

export const runtime = "nodejs"

const schema = z.object({ emoji: z.string().min(1).max(16) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  // The picker is open-ended, so the server is what stops arbitrary text being
  // stored and rendered as a reaction.
  if (!parsed.success || !isValidEmoji(parsed.data.emoji)) {
    return NextResponse.json({ error: "That is not an emoji." }, { status: 400 })
  }

  const { id } = await params
  const conversationId = await getMessageConversationId(id)
  if (!conversationId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const participant = await resolveParticipant(session, conversationId)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Counted before the toggle, so removing a reaction is never blocked by the
  // cap that adding one would hit.
  const existingCount = await countReactionsByUser(id, participant.userId)
  const result = await toggleReaction(id, participant.userId, parsed.data.emoji)

  if (result.added && existingCount >= MAX_REACTIONS_PER_USER) {
    // Undo: the cap is per user per message and we only know we crossed it
    // after learning this was an add, not a remove.
    await toggleReaction(id, participant.userId, parsed.data.emoji)
    return NextResponse.json(
      { error: `Up to ${MAX_REACTIONS_PER_USER} reactions per message.` },
      { status: 429 },
    )
  }

  return NextResponse.json({ added: result.added, reaction: result.reaction })
}
