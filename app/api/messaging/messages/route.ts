// POST /api/messaging/messages — send a message
//
// This is where the 25 MB cap is actually enforced. The sign-URL route checked
// what the client CLAIMED; a signed PUT URL constrains Content-Type but not
// length, so anything already uploaded is verified against its real metadata
// before a row exists. Any failure deletes every object from this send.
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { resolveParticipant } from "@/lib/messaging/access"
import { kindForMime } from "@/lib/messaging/attachments"
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_BODY_LENGTH } from "@/lib/messaging/config"
import { deleteAttachmentObject, verifyUploadedObject } from "@/lib/messaging/storage"
import { previewFor } from "@/lib/messaging/unread"
import { createMessage, getMessageWithExtras, type AttachmentInsert } from "@/lib/db/messages"

export const runtime = "nodejs"

const schema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().max(MAX_BODY_LENGTH).optional().nullable(),
  attachments: z
    .array(
      z.object({
        storage_path: z.string().min(1),
        original_filename: z.string().max(255).optional().nullable(),
        width: z.number().int().positive().optional().nullable(),
        height: z.number().int().positive().optional().nullable(),
        duration_seconds: z.number().nonnegative().optional().nullable(),
      }),
    )
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { conversation_id, attachments = [] } = parsed.data
  const body = parsed.data.body?.trim() || null

  if (!body && attachments.length === 0) {
    return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 })
  }

  const participant = await resolveParticipant(session, conversation_id)
  if (!participant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Every path below that fails after this point must leave no orphaned bytes.
  // Promise.resolve wraps the call so a synchronous throw here cannot turn a
  // clean 413 into a 500 — which would lose the error AND leak the object.
  const storedPaths = attachments.map((a) => a.storage_path)
  const cleanup = () =>
    Promise.all(storedPaths.map((p) => Promise.resolve(deleteAttachmentObject(p)).catch(() => {})))

  const rows: AttachmentInsert[] = []
  for (const attachment of attachments) {
    // An upload path outside this conversation would let one client attach
    // another's file to their own message.
    if (!attachment.storage_path.startsWith(`messaging/${conversation_id}/`)) {
      await cleanup()
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 })
    }

    const verified = await verifyUploadedObject(attachment.storage_path)
    if (!verified.ok) {
      await cleanup()
      const status = verified.reason === "too_large" ? 413 : 400
      const message =
        verified.reason === "too_large"
          ? "Files must be 25 MB or smaller."
          : verified.reason === "wrong_type"
            ? "That file type is not supported. Send an image or a video."
            : "That upload did not finish. Try again."
      return NextResponse.json({ error: message }, { status })
    }

    // kind and mime come from the VERIFIED object, never from the client.
    const kind = kindForMime(verified.contentType)
    if (!kind) {
      await cleanup()
      return NextResponse.json({ error: "That file type is not supported." }, { status: 400 })
    }

    rows.push({
      kind,
      storage_path: attachment.storage_path,
      mime_type: verified.contentType,
      byte_size: verified.size,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      duration_seconds: attachment.duration_seconds ?? null,
      original_filename: attachment.original_filename ?? null,
    })
  }

  const created = await createMessage({
    conversation_id,
    sender_user_id: participant.userId,
    // Derived from the session, never from the request: a client cannot post
    // as the coach by asking to.
    sender_role: participant.role,
    body,
    preview: previewFor(body, rows.length, rows[0]?.kind ?? null),
    attachments: rows,
  })

  const message = await getMessageWithExtras(created.message_id)
  return NextResponse.json({ message }, { status: 201 })
}
