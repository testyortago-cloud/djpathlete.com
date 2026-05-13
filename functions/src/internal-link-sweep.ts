import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { spliceFirstAnchor } from "./lib/html-splice.js"

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SUCCESSFUL_INSERTIONS = 2

// ─── Anchor selection schema ────────────────────────────────────────────────

const anchorResultSchema = z.object({
  anchor: z.string().nullable(),
  reason: z.string().max(500).optional(),
})

const ANCHOR_SYSTEM_PROMPT = `You are an SEO assistant for darrenjpaul.com, a strength & conditioning blog.

Given the body of an EXISTING blog post (the "host") and a TARGET post we want to link to from this host, your job is to identify ONE natural anchor phrase already present in the host body that should become a link to the target.

Hard rules:
1. The anchor MUST be a verbatim substring of the host body — NOT paraphrased, NOT translated.
2. The anchor MUST be 2-6 words. Single words are too generic; longer phrases break flow.
3. The anchor MUST appear in flowing prose. Reject anchors inside headings (<h1>-<h6>), captions, or existing links.
4. The host paragraph containing the anchor MUST be topically related to the target post — both should be discussing the same concept at that exact point.
5. If no anchor in this host fits cleanly, return null. Better to skip than force a bad link.

Output a JSON object: { anchor: string | null, reason?: string }`

function buildAnchorPrompt(args: {
  hostTitle: string
  hostBody: string
  targetTitle: string
  targetSlug: string
}): string {
  return `── TARGET POST ──
Title: ${args.targetTitle}
Slug: /blog/${args.targetSlug}

── HOST POST (you are picking an anchor from THIS body) ──
Title: ${args.hostTitle}

Body HTML:
${args.hostBody}

Pick the best natural anchor phrase from the host body that should link to the target. Return null if no clean fit.`
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleInternalLinkSweep(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    targetBlogPostId: string
    candidateAnchorPostIds: string[]
    userId: string
  }

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Load target post (we only need slug + title; the body isn't used for anchor selection).
    const { data: target, error: targetErr } = await supabase
      .from("blog_posts")
      .select("id, slug, title")
      .eq("id", input.targetBlogPostId)
      .single()
    if (targetErr || !target) {
      throw new Error(`target post not found: ${input.targetBlogPostId}`)
    }
    const targetPost = target as unknown as { id: string; slug: string; title: string }

    // Iterate candidates one at a time, stopping after MAX_SUCCESSFUL_INSERTIONS.
    let insertions = 0
    const attempted: Array<{ candidateId: string; outcome: "inserted" | "no_anchor" | "anchor_not_in_body" }> = []

    for (const candidateId of input.candidateAnchorPostIds) {
      if (insertions >= MAX_SUCCESSFUL_INSERTIONS) break

      // Load this candidate's content.
      const { data: candidate, error: candidateErr } = await supabase
        .from("blog_posts")
        .select("id, slug, title, content")
        .eq("id", candidateId)
        .single()
      if (candidateErr || !candidate) {
        console.warn(`[internal-link-sweep] candidate ${candidateId} not found, skipping`)
        continue
      }
      const cand = candidate as unknown as {
        id: string
        slug: string
        title: string
        content: string
      }

      // Ask Claude for an anchor.
      const userMsg = buildAnchorPrompt({
        hostTitle: cand.title,
        hostBody: cand.content,
        targetTitle: targetPost.title,
        targetSlug: targetPost.slug,
      })
      const aiResult = await callAgent(ANCHOR_SYSTEM_PROMPT, userMsg, anchorResultSchema, {
        model: MODEL_SONNET,
      })
      const anchor = aiResult.content.anchor?.trim() ?? ""
      if (!anchor) {
        attempted.push({ candidateId, outcome: "no_anchor" })
        continue
      }

      // Hallucination guard: confirm the anchor is actually a substring of the host body.
      if (!cand.content.toLowerCase().includes(anchor.toLowerCase())) {
        console.warn(
          `[internal-link-sweep] candidate ${candidateId} — Claude returned anchor "${anchor}" not in body; skipping`,
        )
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      // Splice and write back.
      const splicedContent = spliceFirstAnchor(cand.content, targetPost.slug, anchor)
      if (splicedContent === cand.content) {
        // spliceFirstAnchor returned unchanged — anchor was found but only inside existing <a>.
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      const { error: updateErr } = await supabase
        .from("blog_posts")
        .update({ content: splicedContent, updated_at: new Date().toISOString() })
        .eq("id", candidateId)
      if (updateErr) {
        console.error(`[internal-link-sweep] update failed for ${candidateId}:`, updateErr.message)
        attempted.push({ candidateId, outcome: "anchor_not_in_body" })
        continue
      }

      insertions++
      attempted.push({ candidateId, outcome: "inserted" })
      console.log(
        `[internal-link-sweep] inserted link in ${candidateId} (${cand.slug}) — anchor="${anchor}"`,
      )
    }

    // Log generation (non-fatal).
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "internal_link_sweep",
          targetBlogPostId: input.targetBlogPostId,
          candidates: input.candidateAnchorPostIds,
        },
        output_summary: `Sweep done — ${insertions}/${attempted.length} insertions`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: 0,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch {
      /* non-fatal */
    }

    await jobRef.update({
      status: "completed",
      result: {
        target_blog_post_id: input.targetBlogPostId,
        target_slug: targetPost.slug,
        insertions,
        attempted,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[internal-link-sweep] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
