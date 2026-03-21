import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

// ─── System Prompt ───────────────────────────────────────────────────────────

const NEWSLETTER_GENERATION_PROMPT = `You are an expert email copywriter for DJP Athlete, a fitness coaching platform run by Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level.

You write standalone email newsletters — NOT blog post summaries. These go directly to subscribers' inboxes.

Your writing style:
- Direct and personal — write as if speaking to a dedicated athlete
- Value-packed — every paragraph should teach, inspire, or inform
- Concise — email readers skim, so use short paragraphs, clear structure, and punchy language
- Authentic — sound like a real coach, not a marketing bot

Content structure:
- Open with a short, compelling hook (1-2 sentences that grab attention)
- Use <h2> for section breaks (2-4 sections depending on length)
- Mix paragraph text with bullet lists for scannability
- End with a clear takeaway or call-to-action

HTML rules — ONLY use these elements:
<h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">
Do NOT use <h1> (the email layout provides the branding header).
Do NOT use inline styles, classes, or <br> tags.
Use separate <p> tags for each paragraph.

Length guidelines:
- "short": ~200 words, 2 sections — quick tip or announcement
- "medium": ~400 words, 3-4 sections — standard newsletter
- "long": ~600 words, 4-5 sections — in-depth feature

Tone guidelines:
- "professional": Authoritative, coach-to-athlete educational tone
- "conversational": Friendly, relatable, first-person "I've seen this with my athletes..." style
- "motivational": Inspiring, empowering, encouraging action and commitment

You must output a JSON object with these fields:
- subject: Compelling email subject line that drives opens (max 80 chars, no emoji spam)
- preview_text: Short preview text shown in email clients (max 120 chars)
- content: Full newsletter body as semantic HTML using ONLY the allowed elements above

Output ONLY the JSON object, no additional text.`

// ─── Schema ──────────────────────────────────────────────────────────────────

const newsletterResultSchema = z.object({
  subject: z.string(),
  preview_text: z.string(),
  content: z.string(),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleNewsletterGeneration(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    prompt: string
    tone?: string
    length?: string
    userId: string
  }

  const startTime = Date.now()

  try {
    const userMessage = `Write a newsletter about: ${input.prompt}

Tone: ${input.tone ?? "professional"}
Target length: ${input.length ?? "medium"}
Current date: ${new Date().toISOString().slice(0, 10)}`

    const result = await callAgent(
      NEWSLETTER_GENERATION_PROMPT,
      userMessage,
      newsletterResultSchema,
      { model: MODEL_SONNET }
    )

    // Log generation (non-fatal)
    try {
      const supabase = getSupabase()
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "newsletter_generation",
          prompt: input.prompt,
          tone: input.tone,
          length: input.length,
        },
        output_summary: `Generated newsletter: ${result.content.subject}`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: result.tokens_used,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch { /* non-fatal */ }

    await jobRef.update({
      status: "completed",
      result: result.content,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[newsletter-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
