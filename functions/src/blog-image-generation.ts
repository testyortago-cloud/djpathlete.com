import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { extractImagePrompts } from "./ai/image-prompts.js"
import { generateFalImage } from "./lib/fal-client.js"
import { transcodeAndUpload } from "./lib/image-pipeline.js"
import { generateAltText } from "./lib/image-alt-text.js"
import { findQualifyingSections, spliceInlineImages } from "./lib/html-splice.js"
import { getSupabase } from "./lib/supabase.js"

const HERO_MODEL = "fal-ai/flux-pro/v1.1"
const INLINE_MODEL = "fal-ai/flux/schnell"
const HERO_DIMS = { width: 1200, height: 630 }
const INLINE_DIMS = { width: 1024, height: 576 }

export interface BlogImageGenerationInput {
  blog_post_id: string
}

export interface InlineImageRecord {
  url: string
  alt: string
  prompt: string
  section_h2: string
  width: number
  height: number
}

export async function handleBlogImageGeneration(jobId: string): Promise<void> {
  const firestore = getFirestore()
  const supabase = getSupabase()
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
    if (!snap.exists) {
      await failJob("ai_jobs doc missing")
      return
    }
    const data = snap.data()!
    const blogPostId = (data.input as BlogImageGenerationInput | undefined)?.blog_post_id
    if (!blogPostId) {
      await failJob("input.blog_post_id is required")
      return
    }

    await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

    // Load the post
    const { data: post, error: postErr } = await supabase
      .from("blog_posts")
      .select("id, title, slug, content, category")
      .eq("id", blogPostId)
      .single()
    if (postErr || !post) {
      await failJob(`blog_posts row ${blogPostId} not found`)
      return
    }

    const slug = (post.slug as string) ?? "post"
    const html = (post.content as string) ?? ""

    // Find sections that qualify for inline images
    const qualifying = findQualifyingSections(html)
    const qualifyingTitles = qualifying.map((s) => s.h2Text)

    // Step 1: ask Claude for image prompts
    const prompts = await extractImagePrompts({
      title: post.title as string,
      content: html,
      category: (post.category as string) ?? "Performance",
      qualifyingSections: qualifyingTitles,
    })

    // Step 2: generate hero (must succeed) + inline (best-effort) in parallel
    const heroPromise = (async () => {
      const fal = await generateFalImage({
        model: HERO_MODEL,
        prompt: prompts.hero_prompt,
        ...HERO_DIMS,
      })
      const upload = await transcodeAndUpload({ buffer: fal.buffer, slug, kind: "hero" })
      const alt = await generateAltText(fal.buffer, fal.mime).catch(() =>
        prompts.hero_prompt.slice(0, 120),
      )
      return { url: upload.url, alt, width: upload.width, height: upload.height }
    })()

    const inlinePromises = prompts.inline_prompts.map(async (p, idx) => {
      const sectionIdx = idx + 1
      try {
        const fal = await generateFalImage({
          model: INLINE_MODEL,
          prompt: p.prompt,
          ...INLINE_DIMS,
        })
        const upload = await transcodeAndUpload({
          buffer: fal.buffer,
          slug,
          kind: "inline",
          sectionIdx,
        })
        const alt = await generateAltText(fal.buffer, fal.mime).catch(() =>
          p.prompt.slice(0, 120),
        )
        const record: InlineImageRecord = {
          url: upload.url,
          alt,
          prompt: p.prompt,
          section_h2: p.section_h2,
          width: upload.width,
          height: upload.height,
        }
        return { ok: true as const, record }
      } catch (err) {
        console.warn(
          `[blog-image-generation] inline section ${sectionIdx} (${p.section_h2}) failed:`,
          (err as Error).message,
        )
        return { ok: false as const, error: (err as Error).message }
      }
    })

    let hero: { url: string; alt: string; width: number; height: number }
    try {
      hero = await heroPromise
    } catch (err) {
      await failJob(`hero generation failed: ${(err as Error).message}`)
      return
    }

    const inlineResults = await Promise.all(inlinePromises)
    const successfulInline = inlineResults
      .filter((r): r is { ok: true; record: InlineImageRecord } => r.ok)
      .map((r) => r.record)
    const failedInlineCount = inlineResults.filter((r) => !r.ok).length

    // Step 3: splice <img> tags into the HTML
    const splicedContent = spliceInlineImages(
      html,
      successfulInline.map((r) => ({
        h2Text: r.section_h2,
        url: r.url,
        alt: r.alt,
        width: r.width,
        height: r.height,
      })),
    )

    // Step 4: write back to blog_posts
    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        cover_image_url: hero.url,
        content: splicedContent,
        inline_images: successfulInline,
      })
      .eq("id", blogPostId)
    if (updateErr) {
      await failJob(`blog_posts update failed: ${updateErr.message}`)
      return
    }

    await jobRef.update({
      status: "completed",
      result: {
        cover_image_url: hero.url,
        inline_images: successfulInline,
        failed_inline_count: failedInlineCount,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown blog-image-generation error")
  }
}
