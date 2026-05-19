import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { extractImagePrompts, PROMPT_VERSION } from "./ai/image-prompts.js"
import { generateFalImage } from "./lib/fal-client.js"
import { transcodeAndUpload, RENDER_DIMENSIONS, FINAL_DIMENSIONS } from "./lib/image-pipeline.js"
import { generateAltText } from "./lib/image-alt-text.js"
import { findQualifyingSections, spliceInlineImages } from "./lib/html-splice.js"
import { judgeImageQuality, QUALITY_RETRY_THRESHOLD } from "./lib/image-quality-judge.js"
import { getSupabase } from "./lib/supabase.js"

const HERO_MODEL = "fal-ai/flux-pro/v1.1-ultra"
const INLINE_MODEL = "fal-ai/flux-pro/v1.1"

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
  seed: number
  model: string
  prompt_version: string
  quality_score: number
  quality_reasons: string[]
  judge_failed: boolean
  attempts: number
}

export interface CoverImageMeta {
  seed: number
  model: string
  prompt: string
  prompt_version: string
  quality_score: number
  quality_reasons: string[]
  judge_failed: boolean
  attempts: number
}

interface GenerateAndJudgeArgs {
  model: string
  prompt: string
  renderWidth: number
  renderHeight: number
  slug: string
  kind: "hero" | "inline"
  sectionIdx?: number
  // Hero images get one retry on low quality; inline images do not (cost
  // discipline — there can be up to 5 inline per post vs 1 hero).
  allowRetry: boolean
}

interface GenerateAndJudgeResult {
  url: string
  width: number
  height: number
  alt: string
  buffer: Buffer
  mime: string
  seed: number
  quality_score: number
  quality_reasons: string[]
  judge_failed: boolean
  attempts: number
}

async function generateJudgeAndRetry(args: GenerateAndJudgeArgs): Promise<GenerateAndJudgeResult> {
  const maxAttempts = args.allowRetry ? 2 : 1
  let attempts = 0
  let lastResult: GenerateAndJudgeResult | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++
    const fal = await generateFalImage({
      model: args.model,
      prompt: args.prompt,
      width: args.renderWidth,
      height: args.renderHeight,
      // Let fal pick a fresh seed on each attempt by not passing one.
    })
    const upload = await transcodeAndUpload({
      buffer: fal.buffer,
      slug: args.slug,
      kind: args.kind,
      sectionIdx: args.sectionIdx,
    })
    const judgment = await judgeImageQuality({
      buffer: fal.buffer,
      mime: fal.mime,
      originalPrompt: args.prompt,
    }).catch((err) => {
      console.warn(`[blog-image-generation] judge threw for ${args.kind}: ${(err as Error).message}`)
      return { score: 7, reasons: ["judge threw — accepting"], judge_failed: true }
    })
    const alt = (await generateAltText(fal.buffer, fal.mime).catch(() => "")) || args.prompt.slice(0, 120)

    lastResult = {
      url: upload.url,
      width: upload.width,
      height: upload.height,
      alt,
      buffer: fal.buffer,
      mime: fal.mime,
      seed: fal.seed,
      quality_score: judgment.score,
      quality_reasons: judgment.reasons,
      judge_failed: judgment.judge_failed,
      attempts,
    }

    // Retry only if (a) the judge says the image is bad AND (b) the judge itself succeeded.
    // If the judge itself failed (parse error or thrown), accept the image — retrying
    // would double fal spend without quality signal.
    if (judgment.judge_failed) break
    if (judgment.score >= QUALITY_RETRY_THRESHOLD) break
  }

  if (!lastResult) throw new Error("generateJudgeAndRetry produced no result")
  return lastResult
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

    const qualifying = findQualifyingSections(html)
    const qualifyingTitles = qualifying.map((s) => s.h2Text)

    const prompts = await extractImagePrompts({
      title: post.title as string,
      content: html,
      category: (post.category as string) ?? "Performance",
      qualifyingSections: qualifyingTitles,
    })

    let hero: GenerateAndJudgeResult
    try {
      hero = await generateJudgeAndRetry({
        model: HERO_MODEL,
        prompt: prompts.hero_prompt,
        renderWidth: RENDER_DIMENSIONS.hero.width,
        renderHeight: RENDER_DIMENSIONS.hero.height,
        slug,
        kind: "hero",
        allowRetry: true,
      })
    } catch (err) {
      await failJob(`hero generation failed: ${(err as Error).message}`)
      return
    }

    const coverMeta: CoverImageMeta = {
      seed: hero.seed,
      model: HERO_MODEL,
      prompt: prompts.hero_prompt,
      prompt_version: PROMPT_VERSION,
      quality_score: hero.quality_score,
      quality_reasons: hero.quality_reasons,
      judge_failed: hero.judge_failed,
      attempts: hero.attempts,
    }

    const inlinePromises = prompts.inline_prompts.map(async (p, idx) => {
      const sectionIdx = idx + 1
      try {
        const result = await generateJudgeAndRetry({
          model: INLINE_MODEL,
          prompt: p.prompt,
          renderWidth: RENDER_DIMENSIONS.inline.width,
          renderHeight: RENDER_DIMENSIONS.inline.height,
          slug,
          kind: "inline",
          sectionIdx,
          allowRetry: false,
        })
        const record: InlineImageRecord = {
          url: result.url,
          alt: result.alt,
          prompt: p.prompt,
          section_h2: p.section_h2,
          width: result.width,
          height: result.height,
          seed: result.seed,
          model: INLINE_MODEL,
          prompt_version: PROMPT_VERSION,
          quality_score: result.quality_score,
          quality_reasons: result.quality_reasons,
          judge_failed: result.judge_failed,
          attempts: result.attempts,
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

    const inlineResults = await Promise.all(inlinePromises)
    const successfulInline = inlineResults
      .filter((r): r is { ok: true; record: InlineImageRecord } => r.ok)
      .map((r) => r.record)
    const failedInlineCount = inlineResults.filter((r) => !r.ok).length

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

    const { error: updateErr } = await supabase
      .from("blog_posts")
      .update({
        cover_image_url: hero.url,
        cover_image_meta: coverMeta,
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
        cover_image_meta: coverMeta,
        inline_images: successfulInline,
        failed_inline_count: failedInlineCount,
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    await failJob((err as Error).message ?? "Unknown blog-image-generation error")
  }
}

export { FINAL_DIMENSIONS }
