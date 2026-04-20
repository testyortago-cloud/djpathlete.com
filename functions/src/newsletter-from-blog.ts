// functions/src/newsletter-from-blog.ts
// Firebase Function: generate an AI newsletter draft from a published blog post.
// Triggered by ai_jobs docs with type "newsletter_from_blog".

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

export interface NewsletterFromBlogInput {
  blog_post_id: string
  tone?: "professional" | "conversational" | "motivational"
  length?: "short" | "medium" | "long"
}

interface BuildMessageParams {
  post: {
    title: string
    excerpt: string
    content: string
    category: string | null
    tags: string[]
  }
  tone: string
  length: string
}

export function buildUserMessage({ post, tone, length }: BuildMessageParams): string {
  const tagLines = post.tags.length > 0 ? `Tags:\n${post.tags.map((t) => `- ${t}`).join("\n")}` : ""
  const categoryLine = post.category ? `Category: ${post.category}` : ""

  return [
    "# BLOG POST TITLE",
    post.title,
    "",
    "# BLOG POST EXCERPT",
    post.excerpt,
    "",
    "# BLOG POST CONTENT",
    post.content,
    "",
    categoryLine,
    tagLines,
    "",
    "# INSTRUCTIONS",
    `Write a newsletter that distills the blog post above into an email readers will actually open. Tone: ${tone}. Length: ${length}. Do NOT just summarize — write a standalone email that teases + elaborates on the blog's key idea and links readers to the full article.`,
  ]
    .filter(Boolean)
    .join("\n")
}

const NEWSLETTER_FROM_BLOG_PROMPT = `You are an expert email copywriter for DJP Athlete. Given a blog post, write a standalone email newsletter that distills its key idea, entices subscribers to read the full post, and can stand on its own in an inbox.

Style: direct, personal, value-packed, concise. Open with a hook, use <h2> for 2-4 section breaks, end with a clear takeaway. Mix paragraphs and bullet lists for scannability.

HTML rules: ONLY <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">. No <h1>, no inline styles, no classes, no <br>.

Length guidelines:
- "short": ~200 words, 2 sections
- "medium": ~400 words, 3-4 sections
- "long": ~600 words, 4-5 sections

Output JSON with: subject (max 80 chars, no emoji spam), preview_text (max 120 chars), content (semantic HTML per the rules above).`

const NewsletterSchema = z.object({
  subject: z.string().max(200),
  preview_text: z.string().max(200),
  content: z.string(),
})

export async function handleNewsletterFromBlog(jobId: string): Promise<void> {
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

    const input = data.input as NewsletterFromBlogInput
    if (!input?.blog_post_id) {
      await failJob("input.blog_post_id is required")
      return
    }

    // createAiJob writes userId into input — and also in the top-level doc
    const userId = (data.input?.userId as string | undefined) ?? (data.userId as string | undefined)
    if (!userId) {
      await failJob("userId missing from ai_jobs")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()
    const { data: postRow, error: postErr } = await supabase
      .from("blog_posts")
      .select("title, excerpt, content, category, tags")
      .eq("id", input.blog_post_id)
      .single()
    if (postErr || !postRow) {
      await failJob(`Blog post not found: ${postErr?.message ?? "missing"}`)
      return
    }

    const userMessage = buildUserMessage({
      post: {
        title: postRow.title as string,
        excerpt: (postRow.excerpt as string) ?? "",
        content: postRow.content as string,
        category: (postRow.category as string | null) ?? null,
        tags: (postRow.tags as string[]) ?? [],
      },
      tone: input.tone ?? "professional",
      length: input.length ?? "medium",
    })

    const result = await callAgent(NEWSLETTER_FROM_BLOG_PROMPT, userMessage, NewsletterSchema, {
      model: MODEL_SONNET,
    })

    const { data: inserted, error: insertErr } = await supabase
      .from("newsletters")
      .insert({
        subject: result.content.subject,
        preview_text: result.content.preview_text,
        content: result.content.content,
        source_blog_post_id: input.blog_post_id,
        author_id: userId,
        status: "draft",
      })
      .select("id, subject")
      .single()
    if (insertErr || !inserted) {
      await failJob(`Newsletter insert failed: ${insertErr?.message ?? "unknown"}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        newsletter_id: inserted.id,
        subject: inserted.subject,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown newsletter-from-blog error")
  }
}
