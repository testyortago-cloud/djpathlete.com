import sharp from "sharp"
import { getSupabase } from "./supabase.js"

const BUCKET = "blog-images"

// Final delivered dimensions (what we serve in <img> tags).
export const FINAL_DIMENSIONS = {
  hero: { width: 1200, height: 630 },
  inline: { width: 1024, height: 576 },
} as const

// Render dimensions we ask the image model for. 2x final, then we downscale
// with lanczos3 in Sharp. This trades ~4x pixel budget at fal for visibly
// sharper output — the same trick wedding photographers used moving from
// in-camera JPEGs to RAW-then-export.
export const RENDER_DIMENSIONS = {
  hero: { width: 2400, height: 1260 },
  inline: { width: 2048, height: 1152 },
} as const

const WEBP_QUALITY = {
  hero: 90,
  inline: 86,
} as const

export type ImageKind = "hero" | "inline"

export interface TranscodeAndUploadInput {
  buffer: Buffer
  slug: string
  kind: ImageKind
  sectionIdx?: number
}

export interface TranscodeAndUploadResult {
  url: string
  width: number
  height: number
  path: string
}

function buildPath(slug: string, kind: ImageKind, sectionIdx?: number): string {
  if (kind === "hero") return `${slug}-hero.webp`
  if (typeof sectionIdx !== "number") {
    throw new Error("sectionIdx is required for inline images")
  }
  return `${slug}-section-${sectionIdx}.webp`
}

export async function transcodeAndUpload(input: TranscodeAndUploadInput): Promise<TranscodeAndUploadResult> {
  const dims = FINAL_DIMENSIONS[input.kind]
  const quality = WEBP_QUALITY[input.kind]
  const path = buildPath(input.slug, input.kind, input.sectionIdx)

  const webpBuffer = await sharp(input.buffer)
    .resize(dims.width, dims.height, {
      fit: "cover",
      position: "center",
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality, effort: 5 })
    .toBuffer()

  const supabase = getSupabase()
  const { error } = await supabase.storage.from(BUCKET).upload(path, webpBuffer, {
    contentType: "image/webp",
    upsert: true,
  })
  if (error) throw new Error(`Supabase upload failed (${path}): ${error.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return { url: pub.publicUrl, width: dims.width, height: dims.height, path }
}
