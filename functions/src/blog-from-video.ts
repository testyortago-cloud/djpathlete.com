// functions/src/blog-from-video.ts
// Firebase Function: turn a transcribed video into a research-grounded,
// fact-checked blog draft. Owns the full pipeline in-process.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { tavilySearch, tavilyExtract } from "./lib/tavily.js"
import { getSupabase } from "./lib/supabase.js"
import { buildResearchBrief, type TavilyResearchBrief } from "./lib/research-brief.js"
import { runFactCheck } from "./tavily-fact-check.js"

export interface BlogFromVideoInput {
  video_upload_id: string
  blog_post_id: string
  tone: "professional" | "conversational" | "motivational"
  length: "short" | "medium" | "long"
}

interface DeriveTopicParams {
  videoTitle: string
  transcript: string
}

export function deriveResearchTopic({ videoTitle, transcript }: DeriveTopicParams): string {
  const title = videoTitle.trim()
  const excerpt = transcript.slice(0, 400).trim()
  if (title && excerpt) {
    return `${title} — ${excerpt}`.slice(0, 400)
  }
  return (title || excerpt).slice(0, 400)
}

interface BuildMessageParams {
  transcript: string
  brief: TavilyResearchBrief
  tone: string
  length: string
  videoTitle: string
}

export function buildBlogUserMessage({
  transcript,
  brief,
  tone,
  length,
  videoTitle,
}: BuildMessageParams): string {
  const sources = brief.results
    .slice(0, 5)
    .map((r) => `- ${r.title} (${r.url})`)
    .join("\n")

  return [
    `# VIDEO TITLE`,
    videoTitle,
    "",
    `# VIDEO TRANSCRIPT`,
    transcript,
    "",
    `# RESEARCH`,
    brief.summary ? `Summary: ${brief.summary}` : "(no summary available)",
    sources ? `\nSources:\n${sources}` : "",
    "",
    `# INSTRUCTIONS`,
    `Write a blog post. Tone: ${tone}. Length: ${length}. Use the video as the primary input and cite research URLs above where relevant. Output as the structured JSON schema the system prompt describes.`,
  ].join("\n")
}

// Silently truncate meta_description on the rare overrun rather than failing
// the whole job — the frontend validator caps at 160 chars; the admin can
// hand-edit before saving if the truncation cuts something important.
function capMetaDescription(s: string): string {
  if (s.length <= 160) return s
  return s.slice(0, 157).trimEnd() + "…"
}

const BlogGenerationSchema = z.object({
  title: z.string().max(200),
  slug: z.string().max(200),
  excerpt: z.string().min(10).max(500),
  content: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
})

const BLOG_SYSTEM_PROMPT = `You are an expert content writer for DJP Athlete, a fitness coaching platform run by Darren Paul, a strength & conditioning coach. Write an evidence-based, practical, engaging blog post from a video transcript and research brief.

You must output a JSON object with: title (max 200), slug (lowercase, hyphens only, max 200), excerpt (10-500), content (semantic HTML using only h2/h3/p/ul/ol/li/blockquote/strong/em/u/a), category ("Performance" | "Recovery" | "Coaching" | "Youth Development"), tags (3-5 lowercase keywords), meta_description (AIM FOR 140-150 CHARACTERS — do not exceed 150).

Use inline <a href="..."> source references where the research brief provides URLs. Never fabricate URLs. Do not use <h1> (the title serves that purpose).`

function emptyBrief(topic: string): TavilyResearchBrief {
  return {
    topic,
    summary: null,
    results: [],
    extracted: [],
    generated_at: new Date().toISOString(),
  }
}

export async function handleBlogFromVideo(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const jobRef = firestore.collection("ai_jobs").doc(jobId)

  async function failJob(message: string) {
    await jobRef.update({
      status: "failed",
      error: message,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  try {
    const snap = await jobRef.get()
    const data = snap.data()
    if (!data) {
      await failJob("ai_jobs doc disappeared")
      return
    }

    const input = data.input as BlogFromVideoInput
    if (!input?.video_upload_id || !input?.blog_post_id) {
      await failJob("input.video_upload_id and input.blog_post_id are required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()

    // 1. Read transcript + video
    const { data: videoRow, error: videoErr } = await supabase
      .from("video_uploads")
      .select("id, title")
      .eq("id", input.video_upload_id)
      .single()
    if (videoErr || !videoRow) {
      await failJob(`Video not found: ${videoErr?.message ?? "missing"}`)
      return
    }
    const { data: transcriptRow, error: trErr } = await supabase
      .from("video_transcripts")
      .select("transcript_text")
      .eq("video_upload_id", input.video_upload_id)
      .maybeSingle()
    if (trErr || !transcriptRow?.transcript_text) {
      await failJob("Video has no transcript")
      return
    }
    const transcript = transcriptRow.transcript_text as string
    const videoTitle = (videoRow.title as string) ?? ""

    // 2. Tavily research (best-effort)
    let brief: TavilyResearchBrief | null = null
    try {
      const topic = deriveResearchTopic({ videoTitle, transcript })
      const search = await tavilySearch({
        query: topic,
        search_depth: "basic",
        include_answer: true,
        max_results: 10,
      })
      let extracted: Array<{ url: string; content: string }> = []
      if (search.results.length > 0) {
        const urls = search.results.slice(0, 3).map((r) => r.url)
        const ext = await tavilyExtract({ urls })
        extracted = ext.results.map((r) => ({ url: r.url, content: r.raw_content }))
      }
      brief = buildResearchBrief({
        topic,
        search: { answer: search.answer ?? null, results: search.results },
        extractedContent: extracted,
        generatedAt: new Date().toISOString(),
      })
      await supabase.from("blog_posts").update({ tavily_research: brief }).eq("id", input.blog_post_id)
    } catch (err) {
      console.error("[blog-from-video] Tavily research failed:", err)
    }

    // 3. Claude generation — use the POSITIONAL callAgent signature
    const userMessage = buildBlogUserMessage({
      transcript,
      brief: brief ?? emptyBrief(deriveResearchTopic({ videoTitle, transcript })),
      tone: input.tone,
      length: input.length,
      videoTitle,
    })
    const generated = await callAgent(BLOG_SYSTEM_PROMPT, userMessage, BlogGenerationSchema, {
      model: MODEL_SONNET,
    })

    await supabase
      .from("blog_posts")
      .update({
        title: generated.content.title,
        slug: generated.content.slug,
        excerpt: generated.content.excerpt,
        content: generated.content.content,
        category: generated.content.category,
        tags: generated.content.tags,
        meta_description: generated.content.meta_description,
      })
      .eq("id", input.blog_post_id)

    // 4. Fact-check (skipped if research failed)
    let factCheckStatus: "pending" | "passed" | "flagged" | "failed" = "pending"
    if (brief) {
      try {
        const fc = await runFactCheck({
          content: generated.content.content,
          brief,
          blog_post_id: input.blog_post_id,
        })
        factCheckStatus = fc.fact_check_status
      } catch (err) {
        console.error("[blog-from-video] Fact-check failed:", err)
        factCheckStatus = "failed"
        await supabase
          .from("blog_posts")
          .update({ fact_check_status: "failed" })
          .eq("id", input.blog_post_id)
      }
    } else {
      await supabase.from("blog_posts").update({ fact_check_status: "pending" }).eq("id", input.blog_post_id)
    }

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blog_post_id,
        fact_check_status: factCheckStatus,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown blog-from-video error")
  }
}
