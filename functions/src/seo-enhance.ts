// functions/src/seo-enhance.ts
// Firebase Function: post-publish SEO enrichment. Claude generates
// meta_title/meta_description/keywords/json_ld; tag-overlap scorer finds
// up to 5 internal link suggestions. Writes to blog_posts.seo_metadata.

import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"

export interface SeoEnhanceInput {
  blog_post_id: string
}

interface BlogSummaryForScoring {
  id: string
  title: string
  slug: string
  tags: string[]
  category: string | null
}

export interface InternalLinkSuggestion {
  blog_post_id: string
  title: string
  slug: string
  overlap_score: number
  reason: string
}

export function scoreInternalLinks(
  target: BlogSummaryForScoring,
  candidates: BlogSummaryForScoring[],
): InternalLinkSuggestion[] {
  const targetTags = new Set(target.tags ?? [])
  const results: InternalLinkSuggestion[] = []

  for (const c of candidates) {
    if (c.id === target.id) continue
    const shared = (c.tags ?? []).filter((t) => targetTags.has(t))
    const tagScore = shared.length * 2
    const categoryMatch = target.category && target.category === c.category ? 1 : 0
    const score = tagScore + categoryMatch
    if (score < 1) continue

    const parts: string[] = []
    if (shared.length > 0) parts.push(`Shares tags: ${shared.join(", ")}`)
    if (categoryMatch) parts.push("same category")
    results.push({
      blog_post_id: c.id,
      title: c.title,
      slug: c.slug,
      overlap_score: score,
      reason: parts.join(" · "),
    })
  }

  results.sort((a, b) => b.overlap_score - a.overlap_score)
  return results.slice(0, 5)
}

interface BuildSeoPromptParams {
  title: string
  excerpt: string
  content: string
  tags: string[]
  category: string | null
  cover_image_url: string | null
  inline_images: Array<{ url: string; alt: string; width: number; height: number }>
}

export function buildSeoPrompt(p: BuildSeoPromptParams): string {
  const tagLine = p.tags.length > 0 ? `Tags: ${p.tags.join(", ")}` : ""
  const catLine = p.category ? `Category: ${p.category}` : ""
  const heroLine = p.cover_image_url ? `Hero image URL: ${p.cover_image_url}` : ""
  const inlineLines = p.inline_images.length
    ? "Inline images:\n" + p.inline_images.map((i) => `  - ${i.url} (${i.width}x${i.height}, alt: ${i.alt})`).join("\n")
    : ""
  return [
    "# BLOG POST",
    `Title: ${p.title}`,
    `Excerpt: ${p.excerpt}`,
    tagLine,
    catLine,
    heroLine,
    inlineLines,
    "",
    "# CONTENT (first 4000 chars)",
    p.content.slice(0, 4000),
    "",
    "# INSTRUCTIONS",
    "Generate SEO metadata for this post. Output a JSON object with: meta_title (<=60 chars), meta_description (<=155 chars), keywords (5-10 lowercase), json_ld (schema.org Article object with at least @context, @type, headline, description, author { @type: Person, name: 'Darren Paul' }, datePublished, AND an `image` field — if a hero URL is provided above, use it; if inline images are provided, include them as an array of ImageObject with url, width, height, caption=alt).",
  ]
    .filter(Boolean)
    .join("\n")
}

const SeoSchema = z.object({
  meta_title: z.string().max(200),
  meta_description: z.string().max(300),
  keywords: z.array(z.string()),
  json_ld: z.record(z.string(), z.unknown()),
})

const SYSTEM_PROMPT = `You are an SEO specialist generating structured metadata for a fitness/coaching blog. Output strict JSON matching the schema. Do not fabricate facts — use only what the blog post provides.`

export async function handleSeoEnhance(jobId: string): Promise<void> {
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

    const input = data.input as SeoEnhanceInput
    if (!input?.blog_post_id) {
      await failJob("input.blog_post_id is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    const supabase = getSupabase()

    const { data: postRow, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, content, tags, category, published_at, cover_image_url, inline_images")
      .eq("id", input.blog_post_id)
      .single()
    if (postErr || !postRow) {
      await failJob(`Blog post not found: ${postErr?.message ?? "missing"}`)
      return
    }

    const seoPrompt = buildSeoPrompt({
      title: postRow.title as string,
      excerpt: (postRow.excerpt as string) ?? "",
      content: (postRow.content as string) ?? "",
      tags: (postRow.tags as string[]) ?? [],
      category: (postRow.category as string | null) ?? null,
      cover_image_url: (postRow.cover_image_url as string | null) ?? null,
      inline_images: ((postRow.inline_images as unknown) as Array<{
        url: string
        alt: string
        width: number
        height: number
      }>) ?? [],
    })

    const seoResult = await callAgent(SYSTEM_PROMPT, seoPrompt, SeoSchema, { model: MODEL_SONNET })

    const { data: candidates, error: candidatesErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, tags, category")
      .eq("status", "published")
      .neq("id", input.blog_post_id)
      .order("published_at", { ascending: false })
      .limit(50)
    if (candidatesErr) {
      console.error("[seo-enhance] candidates fetch failed:", candidatesErr)
    }

    const suggestions = scoreInternalLinks(
      {
        id: postRow.id as string,
        title: postRow.title as string,
        slug: postRow.slug as string,
        tags: (postRow.tags as string[]) ?? [],
        category: (postRow.category as string | null) ?? null,
      },
      ((candidates as BlogSummaryForScoring[] | null) ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        tags: c.tags ?? [],
        category: c.category,
      })),
    )

    const seoMetadata = {
      meta_title: seoResult.content.meta_title,
      meta_description: seoResult.content.meta_description,
      keywords: seoResult.content.keywords,
      json_ld: seoResult.content.json_ld,
      internal_link_suggestions: suggestions,
      generated_at: new Date().toISOString(),
    }

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({ seo_metadata: seoMetadata })
      .eq("id", input.blog_post_id)
    if (updateErr) {
      await failJob(`seo_metadata update failed: ${updateErr.message}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        blog_post_id: input.blog_post_id,
        suggestions_count: suggestions.length,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await failJob((error as Error).message ?? "Unknown seo-enhance error")
  }
}
