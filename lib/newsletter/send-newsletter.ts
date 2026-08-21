// lib/newsletter/send-newsletter.ts
// The one send path. Called by the Send button's route and by the
// scheduled-content runner.

import { getNewsletterById, updateNewsletter } from "@/lib/db/newsletters"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { buildNewsletterHtml } from "@/lib/email"

export class NewsletterNotSendableError extends Error {
  readonly code: "already_sent" | "too_short"
  constructor(code: "already_sent" | "too_short", message: string) {
    super(message)
    this.name = "NewsletterNotSendableError"
    this.code = code
  }
}

export interface SendNewsletterResult {
  id: string
  queued: true
}

/**
 * Sends a newsletter to the live subscriber list.
 *
 * Ordering is load-bearing: the row is marked `sent` BEFORE the Firebase job
 * is queued. That is the double-send guard — a second caller sees `sent` and
 * refuses. Consequently a failure to queue must NOT revert the row, because
 * reverting risks two sends of the same newsletter.
 */
export async function sendNewsletterNow(args: {
  id: string
  actorId: string
}): Promise<SendNewsletterResult> {
  const newsletter = await getNewsletterById(args.id)

  if (newsletter.status === "sent") {
    throw new NewsletterNotSendableError("already_sent", "Newsletter has already been sent")
  }
  if (!newsletter.content || newsletter.content.length < 10) {
    throw new NewsletterNotSendableError("too_short", "Newsletter content is too short")
  }

  await updateNewsletter(args.id, {
    status: "sent",
    sent_at: new Date().toISOString(),
    scheduled_at: null,
    schedule_failed_reason: null,
  })

  const html = buildNewsletterHtml(newsletter.content)

  const db = getAdminFirestore()
  await db.collection("ai_jobs").doc().set({
    type: "newsletter_send",
    status: "pending",
    input: { newsletterId: args.id, subject: newsletter.subject, html },
    result: null,
    error: null,
    userId: args.actorId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id: args.id, queued: true }
}
