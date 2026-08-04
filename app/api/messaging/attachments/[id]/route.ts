// GET /api/messaging/attachments/[id]
//   ?redirect=1 -> 302 to a freshly signed read URL (what <img src> points at)
//   otherwise   -> JSON metadata plus a signed url
//
// This route exists so a signed GCS URL never becomes a durable href. Threads
// are scrolled back through for weeks; a stored signature expires and the
// thread fills with ExpiredToken images. Re-signing per hit keeps the src a
// stable app URL.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { getAttachmentWithConversation } from "@/lib/db/messages"
import { createAttachmentReadUrl } from "@/lib/messaging/storage"

export const runtime = "nodejs"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const attachment = await getAttachmentWithConversation(id)
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const participant = await resolveParticipant(session, attachment.conversation_id)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = await createAttachmentReadUrl(attachment.storage_path)

  if (request.nextUrl.searchParams.get("redirect") === "1") {
    // no-store: the signature expires, so a cached 302 outlives its target.
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } })
  }

  return NextResponse.json({
    url,
    kind: attachment.kind,
    mime_type: attachment.mime_type,
    byte_size: attachment.byte_size,
    width: attachment.width,
    height: attachment.height,
    duration_seconds: attachment.duration_seconds,
    original_filename: attachment.original_filename,
  })
}
