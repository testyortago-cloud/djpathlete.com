import { z } from "zod"

const ALLOWED_THUMBNAIL_MIME = ["image/jpeg", "image/png", "image/webp"] as const

export const customThumbnailUrlSchema = z.object({
  contentType: z.enum(ALLOWED_THUMBNAIL_MIME),
})

export const commitThumbnailSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("auto") }),
  z.object({
    source: z.enum(["frame", "upload"]),
    thumbnailPath: z.string().min(1, "thumbnailPath is required"),
  }),
])

/** Deterministic path of the auto-captured thumbnail, unchanged since 00088. */
export function autoThumbnailPath(storagePath: string): string {
  return `${storagePath}.thumb.jpg`
}

/**
 * A fresh path per set. A NEW path is what makes a changed thumbnail actually
 * appear: rewriting one path leaves the signed READ URL identical, so browsers
 * keep serving the old image from cache.
 *
 * The path always ends `.jpg`, even though the uploaded bytes may be PNG or
 * WebP (see ALLOWED_THUMBNAIL_MIME above) — that is deliberate, not a bug to
 * "fix" by branching the extension on contentType. The signed upload URL
 * already carries the true Content-Type, every reader signs a URL by this
 * path and never parses the extension to decide how to decode it, and
 * isLegalCustomThumbnailPath below requires the same fixed `.jpg` suffix. The
 * path and the validator are written to agree, so there is no desync to
 * create by leaving the extension alone.
 */
export function customThumbnailPath(storagePath: string, now: number): string {
  return `${storagePath}.thumb-custom-${now}.jpg`
}

/**
 * Does `candidate` belong to THIS video? The commit route accepts a path from
 * the client, so without this a caller could point a row at any blob in the
 * bucket.
 */
export function isLegalCustomThumbnailPath(storagePath: string, candidate: string): boolean {
  return /^\d+\.jpg$/.test(candidate.slice(`${storagePath}.thumb-custom-`.length))
    && candidate.startsWith(`${storagePath}.thumb-custom-`)
}
