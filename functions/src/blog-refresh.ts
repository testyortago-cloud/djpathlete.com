import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import {
  loadVoiceContext,
  composeBlogSystemPrompt,
  formatFewShotsForUserMessage,
  type Register,
  type SeoTarget,
} from "./blog/voice-context.js"
import {
  countWords,
  isTooShort,
  resolveTargetWordCount,
  buildExpansionPrompt,
} from "./blog/length-verifier.js"
import { formatProgramsForPrompt } from "./blog/program-catalog.js"
import { injectAnchorIds } from "./lib/html-splice.js"

// ─── Schema ──────────────────────────────────────────────────────────────────

function capMetaDescription(s: string): string {
  if (s.length <= 160) return s
  return s.slice(0, 157).trimEnd() + "…"
}

const faqEntrySchema = z.object({
  question: z.string().min(5).max(200),
  answer: z.string().min(20).max(800),
})

const refreshResultSchema = z.object({
  title: z.string().min(20).max(120),
  // slug is NOT regenerated — we preserve the existing one
  excerpt: z.string().min(80).max(280),
  content: z.string(),
  category: z.enum(["Performance", "Recovery", "Coaching", "Youth Development"]),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
  faq: z.array(faqEntrySchema).max(5).optional().default([]),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

async function isJobCancelled(jobRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  const snap = await jobRef.get()
  return snap.exists && snap.data()?.status === "cancelled"
}

export async function handleBlogRefresh(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    blogPostId: string
    triggerReason?: string
    userId: string
    references?: { gscTopQueries?: string[] }
  }

  const startTime = Date.now()

  try {
    const supabase = getSupabase()

    // Step 1: Load the existing post.
    const { data: existing, error: readErr } = await supabase
      .from("blog_posts")
      .select("*")
      .eq("id", input.blogPostId)
      .single()
    if (readErr || !existing) {
      throw new Error(`blog_post not found: ${input.blogPostId}`)
    }
    type ExistingPost = {
      id: string
      slug: string
      title: string
      excerpt: string
      content: string
      category: "Performance" | "Recovery" | "Coaching" | "Youth Development"
      tags: string[]
      meta_description: string
      faq: Array<{ question: string; answer: string }> | null
      primary_keyword: string | null
      secondary_keywords: string[] | null
      search_intent: "informational" | "commercial" | "transactional" | null
    }
    const post = existing as unknown as ExistingPost

    // Step 2: Load brand voice + structural rules.
    const voice = await loadVoiceContext(supabase)
    const programsBlock = formatProgramsForPrompt()
    const register: Register = "casual"
    const seoTarget: SeoTarget | undefined = post.primary_keyword
      ? {
          primary_keyword: post.primary_keyword,
          secondary_keywords: post.secondary_keywords ?? [],
          search_intent: post.search_intent ?? null,
        }
      : undefined
    const systemPrompt = composeBlogSystemPrompt({
      voiceProfile: voice.voiceProfile,
      blogStructure: voice.blogStructure,
      programsBlock,
      register,
      seoTarget,
    })

    const targetWordCount = resolveTargetWordCount({ length: "medium" })

    // Step 3: Construct the iteration prompt. The model sees the current
    // post body and iterates on it — does NOT generate from scratch.
    const refsBlock = input.references?.gscTopQueries?.length
      ? `\n\n── CURRENT TOP SEARCH QUERIES FOR THIS URL ──────\nGoogle Search Console currently shows these queries driving impressions to this post. Make sure the refreshed content addresses them directly:\n${input.references.gscTopQueries.map((q) => `  • ${q}`).join("\n")}\n────────────────────────────────────────────────`
      : ""

    const fewShotBlock = formatFewShotsForUserMessage(voice.fewShots)
    const userMessage = `Refresh an existing blog post. Below is the current content. Iterate on it — update stale stats, current-year references, add or strengthen sections suggested by the search queries below (if any). Preserve the post's identity (same topic, same primary keyword, same audience) but make it materially better.

Trigger reason: ${input.triggerReason ?? "manual"}
Primary keyword: ${post.primary_keyword ?? "(none)"}
Current word count target: ${targetWordCount}
Current date: ${new Date().toISOString().slice(0, 10)}
${refsBlock}

── CURRENT POST ──────────────────────────────────────────────
Title: ${post.title}
Excerpt: ${post.excerpt}
Category: ${post.category}
Tags: ${post.tags.join(", ")}

Content:
${post.content}
${fewShotBlock}`

    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-refresh] Job ${jobId} cancelled before AI call`)
      return
    }

    // Step 4: Call Claude.
    const result = await callAgent(systemPrompt, userMessage, refreshResultSchema, { model: MODEL_SONNET })
    let finalContent = result.content
    let totalTokens = result.tokens_used

    // Length verification — same single re-prompt pattern as blog-generation.
    const initialWordCount = countWords(finalContent.content)
    if (isTooShort(initialWordCount, targetWordCount)) {
      console.log(
        `[blog-refresh] First pass too short (${initialWordCount}/${targetWordCount}); running one expansion re-prompt`,
      )
      const h2List = Array.from(finalContent.content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)).map((m) =>
        m[1].replace(/<[^>]+>/g, "").trim(),
      )
      const expansionUserMessage = buildExpansionPrompt({
        currentHtml: finalContent.content,
        actualWordCount: initialWordCount,
        targetWordCount,
        h2List,
      })
      try {
        const expanded = await callAgent(systemPrompt, expansionUserMessage, refreshResultSchema, { model: MODEL_SONNET })
        finalContent = expanded.content
        totalTokens += expanded.tokens_used
      } catch (err) {
        console.warn(`[blog-refresh] Expansion failed, keeping first pass: ${(err as Error).message}`)
      }
    }

    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-refresh] Job ${jobId} cancelled after AI call`)
      return
    }

    // Step 5: Anchor IDs (URL validator skipped here — we trust the iteration
    // to keep already-validated links, and the seo_enhance pass on the next
    // publish will re-check.)
    const contentWithAnchors = injectAnchorIds(finalContent.content)

    // Log generation (non-fatal).
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "blog_refresh",
          blogPostId: input.blogPostId,
          triggerReason: input.triggerReason ?? "manual",
          gscQueries: input.references?.gscTopQueries ?? [],
        },
        output_summary: `Refreshed blog: ${finalContent.title}`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: totalTokens,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch {
      /* non-fatal */
    }

    // Step 6: UPDATE the post in place. Preserves id, slug, published_at,
    // author_id, category, primary_keyword, cover_image_url, seo_metadata.
    // Forces status=draft.
    const nowIso = new Date().toISOString()
    const { data: countRow, error: countErr } = await supabase
      .from("blog_posts")
      .select("refresh_count")
      .eq("id", input.blogPostId)
      .single()
    if (countErr) throw countErr
    const nextRefreshCount = ((countRow as { refresh_count: number | null } | null)?.refresh_count ?? 0) + 1

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        title: finalContent.title,
        excerpt: finalContent.excerpt,
        content: contentWithAnchors,
        meta_description: finalContent.meta_description,
        faq: finalContent.faq ?? [],
        tags: finalContent.tags,
        status: "draft",
        last_refreshed_at: nowIso,
        refresh_count: nextRefreshCount,
        updated_at: nowIso,
      })
      .eq("id", input.blogPostId)
    if (updateErr) throw new Error(`blog_posts update failed: ${updateErr.message}`)

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blogPostId,
        slug: post.slug,
        refresh_count: nextRefreshCount,
        word_count: countWords(finalContent.content),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[blog-refresh] Job ${jobId} failed:`, errorMessage)
    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
