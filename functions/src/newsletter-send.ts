import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { Resend } from "resend"
import { getSupabase } from "./lib/supabase.js"
import { isUndeliverableAddress } from "./lib/newsletter-recipients.js"

const BATCH_SIZE = 100
const BATCH_DELAY_MS = 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function handleNewsletterSend(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    newsletterId: string
    subject: string
    html: string
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const supabase = getSupabase()

  try {
    // Fetch ALL active subscribers. A single select caps at PostgREST's ~1000-row
    // default (Supabase `max-rows`), which would silently send to only the first
    // 1000 of a larger list — page through with .range() until exhausted. A stable
    // total order (id tiebreaker) keeps page boundaries correct when a bulk import
    // shares one subscribed_at.
    const PAGE = 1000
    const listed: { email: string }[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error: subError } = await supabase
        .from("newsletter_subscribers")
        .select("email")
        .is("unsubscribed_at", null)
        .order("subscribed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
      if (subError) throw new Error(`Failed to fetch subscribers: ${subError.message}`)
      const rows = (data ?? []) as { email: string }[]
      listed.push(...rows)
      if (rows.length < PAGE) break
    }

    // One undeliverable address 422s its entire batch of 100 — see
    // lib/newsletter-recipients. Drop them up front and count them as skipped.
    const subscribers = listed.filter((s) => !isUndeliverableAddress(s.email))
    const skipped = listed.length - subscribers.length
    if (skipped > 0) console.warn(`[newsletter-send] Skipping ${skipped} undeliverable address(es)`)

    if (subscribers.length === 0) {
      console.log("[newsletter-send] No active subscribers — skipping")
      await jobRef.update({
        status: "completed",
        result: { sent: 0, failed: 0, total: 0, skipped },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    // RESEND_FROM_EMAIL is bound (sendSecrets), so this fallback only fires if it
    // goes missing. send.darrenjpaul.com is the live account's one verified domain
    // (GET /domains, 2026-09-27); mail. was suspended on 2026-09-26. The account
    // has changed twice, so re-read /domains before trusting this.
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Darren J. Paul <noreply@send.darrenjpaul.com>"
    let sent = 0
    let failed = 0

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE)

      try {
        const { data, error } = await resend.batch.send(
          batch.map((sub) => ({
            from: fromEmail,
            to: sub.email,
            subject: input.subject,
            html: input.html,
          })),
        )

        if (error) {
          console.error(`[newsletter-send] Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error)
          failed += batch.length
        } else {
          sent += data?.data?.length ?? batch.length
        }
      } catch (err) {
        console.error(`[newsletter-send] Batch ${Math.floor(i / BATCH_SIZE) + 1} exception:`, err)
        failed += batch.length
      }

      // Update progress periodically (every 5 batches)
      if ((i / BATCH_SIZE) % 5 === 4) {
        await jobRef
          .update({
            "result.sent": sent,
            "result.failed": failed,
            "result.total": subscribers.length,
            updatedAt: FieldValue.serverTimestamp(),
          })
          .catch(() => {})
      }

      // Rate-limit delay
      if (i + BATCH_SIZE < subscribers.length) {
        await sleep(BATCH_DELAY_MS)
      }
    }

    // Update the newsletter record in Supabase with final counts
    await supabase
      .from("newsletters")
      .update({
        sent_count: sent,
        failed_count: failed,
      })
      .eq("id", input.newsletterId)

    console.log(`[newsletter-send] Done: ${sent}/${subscribers.length} sent, ${failed} failed`)

    await jobRef.update({
      status: "completed",
      result: { sent, failed, total: subscribers.length, skipped },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[newsletter-send] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
