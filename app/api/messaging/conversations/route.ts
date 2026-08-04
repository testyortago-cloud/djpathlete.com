// GET  /api/messaging/conversations — the viewer's conversation list
// POST /api/messaging/conversations — admin-only get-or-create for a client
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getOrCreateConversation, listConversationsWithClients } from "@/lib/db/conversations"
import { sideForSession } from "@/lib/messaging/access"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  const side = sideForSession(session)
  if (!session?.user?.id || !side) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // A client always has exactly one conversation. Creating it on first read
  // means a client who has never been messaged still has a thread to open,
  // rather than an empty state that offers no way forward.
  if (side === "client") {
    await getOrCreateConversation(session.user.id)
  }

  const conversations = await listConversationsWithClients(side, session.user.id)
  return NextResponse.json({ conversations, viewer_role: side })
}

const createSchema = z.object({ client_user_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "client_user_id must be a uuid" }, { status: 400 })
  }

  const conversation = await getOrCreateConversation(parsed.data.client_user_id)

  void recordAudit({
    action: "messaging.conversation_created",
    category: "admin_write",
    outcome: "success",
    target_id: conversation.id,
    metadata: { client_user_id: parsed.data.client_user_id },
  })

  return NextResponse.json({ conversation })
}
