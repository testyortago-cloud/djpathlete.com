// lib/content-schedule/run-due.ts
// Drives scheduled blog posts and newsletters. Called by
// /api/admin/internal/content-schedule-due every five minutes.
//
// Deliberately thin: partitionDue() decides WHAT fires, publishBlogPost() and
// sendNewsletterNow() decide WHAT HAPPENS. This file only orchestrates and
// records outcomes.

import { listScheduledBlogPosts, updateBlogPost } from "@/lib/db/blog-posts"
import { listScheduledNewsletters, updateNewsletter } from "@/lib/db/newsletters"
import { publishBlogPost } from "@/lib/blog/publish-post"
import { sendNewsletterNow } from "@/lib/newsletter/send-newsletter"
import { isCronSkipped } from "@/lib/db/system-settings"
import { recordAudit } from "@/lib/audit/record"
import { partitionDue } from "@/lib/content-schedule/due"
import { CONTENT_SCHEDULE_FLAG, CONTENT_SCHEDULE_DEFAULT } from "@/lib/content-schedule/flag"

export interface RunContentScheduleResult {
  skipped?: "paused" | "disabled"
  considered: number
  published: number
  sent: number
  missed: number
  failed: number
}

const CRON_ACTOR = { id: null, email: null, role: "system" as const }

export async function runContentSchedule(
  options: { now?: Date } = {},
): Promise<RunContentScheduleResult> {
  const now = options.now ?? new Date()

  // Checked BEFORE reading a single row. A switched-off checker must not
  // consume the backlog by declaring it missed — the rows have to survive the
  // flag being flipped back on.
  const gate = await isCronSkipped({ enabledKey: CONTENT_SCHEDULE_FLAG, defaultEnabled: CONTENT_SCHEDULE_DEFAULT })
  if (gate.skipped) {
    return { skipped: gate.reason, considered: 0, published: 0, sent: 0, missed: 0, failed: 0 }
  }

  const [posts, newsletters] = await Promise.all([
    listScheduledBlogPosts(),
    listScheduledNewsletters(),
  ])

  const postParts = partitionDue(posts, now)
  const newsletterParts = partitionDue(newsletters, now)

  let published = 0
  let sent = 0
  let missed = 0
  let failed = 0

  for (const post of postParts.fire) {
    try {
      await publishBlogPost({ id: post.id, actorId: post.author_id })
      published++
      await recordAudit({
        action: "blog.published_on_schedule",
        category: "marketing",
        target: { type: "blog_post", id: post.id },
        actor: CRON_ACTOR,
        metadata: { scheduled_at: post.scheduled_at },
      })
    } catch (err) {
      failed++
      await failPost(post.id, (err as Error).message)
    }
  }

  for (const newsletter of newsletterParts.fire) {
    try {
      await sendNewsletterNow({ id: newsletter.id, actorId: newsletter.author_id })
      sent++
      await recordAudit({
        action: "newsletter.sent_on_schedule",
        category: "marketing",
        target: { type: "newsletter", id: newsletter.id },
        actor: CRON_ACTOR,
        metadata: { scheduled_at: newsletter.scheduled_at },
      })
    } catch (err) {
      failed++
      // Deliberately NOT reverted to draft. sendNewsletterNow marks the row
      // sent before queuing, so a throw may land after the mark — reverting
      // would risk a second send to the entire list. Record it loudly instead.
      console.error(`[content-schedule] newsletter ${newsletter.id} send failed:`, err)
      await recordAudit({
        action: "content.schedule_missed",
        category: "marketing",
        outcome: "failure",
        target: { type: "newsletter", id: newsletter.id },
        actor: CRON_ACTOR,
        error: { message: (err as Error).message },
        metadata: { not_reverted: true, reason: "send may have been queued before the throw" },
      })
    }
  }

  for (const { row, reason } of postParts.missed) {
    missed++
    await failPost(row.id, reason)
  }

  for (const { row, reason } of newsletterParts.missed) {
    missed++
    await updateNewsletter(row.id, {
      status: "draft",
      scheduled_at: null,
      schedule_failed_reason: reason,
    })
    await recordAudit({
      action: "content.schedule_missed",
      category: "marketing",
      target: { type: "newsletter", id: row.id },
      actor: CRON_ACTOR,
      metadata: { reason },
    })
  }

  return {
    considered: posts.length + newsletters.length,
    published,
    sent,
    missed,
    failed,
  }
}

async function failPost(id: string, reason: string): Promise<void> {
  await updateBlogPost(id, {
    status: "draft",
    scheduled_at: null,
    schedule_failed_reason: reason,
  })
  await recordAudit({
    action: "content.schedule_missed",
    category: "marketing",
    target: { type: "blog_post", id },
    actor: CRON_ACTOR,
    metadata: { reason },
  })
}
