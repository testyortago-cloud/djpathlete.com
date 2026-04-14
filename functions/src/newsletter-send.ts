import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { Resend } from "resend"
import { getSupabase } from "./lib/supabase.js"

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
    // Fetch all active subscribers
    const { data: subscribers, error: subError } = await supabase
      .from("newsletter_subscribers")
      .select("email")
      .is("unsubscribed_at", null)
      .order("subscribed_at", { ascending: true })

    if (subError) throw new Error(`Failed to fetch subscribers: ${subError.message}`)
    if (!subscribers || subscribers.length === 0) {
      console.log("[newsletter-send] No active subscribers — skipping")
      await jobRef.update({
        status: "completed",
        result: { sent: 0, failed: 0, total: 0 },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@darrenjpaul.com>"
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
      result: { sent, failed, total: subscribers.length },
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
