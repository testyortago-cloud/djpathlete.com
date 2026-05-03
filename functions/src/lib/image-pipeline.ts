import sharp from "sharp"
import { getSupabase } from "./supabase.js"

const BUCKET = "blog-images"

const DIMENSIONS = {
  hero: { width: 1200, height: 630 },
  inline: { width: 1024, height: 576 },
} as const

export type ImageKind = "hero" | "inline"

export interface TranscodeAndUploadInput {
  buffer: Buffer
  slug: string
  kind: ImageKind
  sectionIdx?: number  // required when kind === "inline"
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
  const dims = DIMENSIONS[input.kind]
  const path = buildPath(input.slug, input.kind, input.sectionIdx)

  const webpBuffer = await sharp(input.buffer)
    .resize(dims.width, dims.height, { fit: "cover", position: "center" })
    .webp({ quality: 82 })
    .toBuffer()

  const supabase = getSupabase()
  const { error } = await supabase.storage.from(BUCKET).upload(path, webpBuffer, {
    contentType: "image/webp",
    upsert: true,
  })
  if (error) throw new Error(`Supabase upload failed (${path}): ${error.message}`)

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return {
    url: pub.publicUrl,
    width: dims.width,
    height: dims.height,
    path,
  }
}
