// lib/funnels/reference-image.ts — preparing a pasted reference design for the
// builder chat (2026-09-14 spec §5).
//
// WHY THE BROWSER DOES THE RESIZING. Claude downscales every image to ~1568px
// on the long edge before the model sees it, so sending more pixels costs
// upload time and request size and buys nothing — the extra pixels are
// discarded server-side. `app/api/upload/funnel-image/route.ts` already reasons
// this way for width/height: "The browser already has the decoded image, so it
// is the cheapest correct place to measure; the alternative is an
// image-processing dependency on the server to re-derive what the picker
// already knew." That argument applies with more force to resizing — the
// server alternative is a `sharp`-class dependency in a Next.js route.
//
// Typical saving on a 4K screenshot: ~10x.
//
// `scaledDimensions` and `referenceImageRejection` are pure and exported
// SEPARATELY from `prepareReferenceImage` on purpose: jsdom has no real 2D
// canvas context, so a test driven through the async path could only assert
// that a stub was called. The arithmetic and the gate are where the bugs are,
// and they are testable on their own.

import {
  BUILDER_REFERENCE_IMAGE_MAX_BASE64,
  BUILDER_REFERENCE_IMAGE_MAX_EDGE,
  BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES,
  BUILDER_REFERENCE_IMAGE_MEDIA_TYPES,
  type BuilderReferenceImageMediaType,
} from "@/lib/funnels/sections/builder-config"

/** One prepared reference image, ready for the build route's request body. */
export interface ReferenceImage {
  mediaType: BuilderReferenceImageMediaType
  /** Bare base64 — no `data:<type>;base64,` prefix. */
  data: string
  /** For the chip in the composer, so the owner can see what they attached. */
  name: string
  /** Decoded byte length AFTER downscale, for the chip's size label. */
  bytes: number
}

/**
 * The target box, preserving the aspect ratio.
 *
 * Scales on the LONG edge, whichever it is. Scaling on `width` unconditionally
 * would leave a tall screenshot — a phone capture, a full-page grab, exactly
 * what an owner pastes — far over the bound on the edge that matters.
 *
 * `Math.max(1, ...)` because an extreme aspect ratio (20000x3) rounds the short
 * edge to 0, and `drawImage` throws on a zero-sized canvas.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = BUILDER_REFERENCE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Why this file cannot be used, in a sentence an owner can act on — or `null`.
 *
 * Checked BEFORE decoding, which is the whole point of the source bound: a
 * 200 MB TIFF should fail immediately with a sentence rather than hang the tab
 * on a canvas draw that was always going to be rejected.
 */
export function referenceImageRejection(file: { type: string; size: number }): string | null {
  if (!(BUILDER_REFERENCE_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return "That file can't be read as a reference. Use a JPEG, PNG, WebP or GIF."
  }
  if (file.size > BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES) {
    return "That image is too large. Try one under 10 MB."
  }
  return null
}

/**
 * Standard (unpadded-alphabet, padded-output) base64 length for `bytes` raw
 * bytes — the exact figure `FileReader.readAsDataURL` produces, so this can be
 * computed from `file.size` alone, before ever reading the file.
 */
function estimatedBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/**
 * Whether the "already small enough, keep the original bytes" shortcut is
 * SAFE to take.
 *
 * There are TWO independent bounds here, in TWO different units, checked by
 * TWO different layers:
 *  - `scaledDimensions`/`BUILDER_REFERENCE_IMAGE_MAX_EDGE` bounds PIXELS, and
 *    is enforced by the code below (re-encoding through the canvas).
 *  - `BUILDER_REFERENCE_IMAGE_MAX_BASE64` bounds ENCODED CHARACTERS, and is
 *    enforced by the build route.
 * A file can be small in pixels (a 1400x1200 PNG is well under the 1568px
 * edge) while still being large in bytes (a photo-heavy brand board saved as
 * PNG can weigh several MB) — PNG's compression ratio depends on the image
 * content, not its dimensions. `BUILDER_REFERENCE_IMAGE_MAX_SOURCE_BYTES`
 * (10 MB) does not catch this either: it is a generous "don't hang the tab"
 * ceiling, not a proxy for the route's much tighter 2,000,000-char cap.
 *
 * So the "keep original bytes" shortcut must be gated on BOTH bounds. Gating
 * it on pixels alone is exactly how a client-accepted file becomes a
 * route-rejected payload: the chip already shows, the request goes out, and
 * the route's generic "Invalid request" is the owner's first sign anything was
 * wrong, with no way to tell what to do differently.
 *
 * `builder-config.test.ts` asserts the source-byte bound is looser than the
 * encoded-char bound as a DESIRABLE property (checking early is cheap, and a
 * tight source bound would reject files a re-encode could still shrink to
 * fit). That is only actually safe once every path that CAN exceed the
 * encoded bound re-encodes when it must — this function is that gate.
 */
export function needsReencode(input: { width: number; height: number; encodedLength: number }): boolean {
  const target = scaledDimensions(input.width, input.height)
  const tooManyPixels = target.width !== input.width || target.height !== input.height
  const tooManyBytes = input.encodedLength > BUILDER_REFERENCE_IMAGE_MAX_BASE64
  return tooManyPixels || tooManyBytes
}

/** `Blob` -> bare base64, with the `data:<type>;base64,` prefix stripped. */
async function toBareBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("That image could not be read."))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(",")
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/**
 * Decode, downscale if needed, and encode for the wire.
 *
 * An image already inside BOTH bounds — pixels AND encoded size — keeps its
 * ORIGINAL BYTES and media type; re-encoding a small PNG costs quality for
 * nothing. Anything over EITHER bound goes through the canvas re-encode, per
 * `needsReencode`'s reasoning.
 *
 * The canvas is filled WHITE before `drawImage`. A PNG with an alpha channel
 * flattens onto black otherwise, and a brand board with a transparent
 * background should read as ink-on-white, not ink-on-black.
 */
export async function prepareReferenceImage(file: File): Promise<ReferenceImage> {
  const rejection = referenceImageRejection(file)
  if (rejection) throw new Error(rejection)

  const bitmap = await createImageBitmap(file)
  try {
    const shouldReencode = needsReencode({
      width: bitmap.width,
      height: bitmap.height,
      encodedLength: estimatedBase64Length(file.size),
    })
    if (!shouldReencode) {
      return {
        mediaType: file.type as BuilderReferenceImageMediaType,
        data: await toBareBase64(file),
        name: file.name || "reference",
        bytes: file.size,
      }
    }

    // `scaledDimensions` is a no-op on width/height when only the BYTE bound
    // tripped `needsReencode` (a small-pixel, heavy-byte image) — the canvas
    // still re-encodes at the same dimensions, which is what shrinks it: a
    // JPEG at q0.85 is routinely a fraction of an equivalent PNG's size.
    const target = scaledDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("That image could not be prepared in this browser.")
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, target.width, target.height)
    context.drawImage(bitmap, 0, 0, target.width, target.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG: a photographed or screenshotted reference is continuous-tone, and
      // the vision endpoint takes it everywhere. The media type is jpeg
      // regardless of what went in.
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85),
    )
    if (!blob) throw new Error("That image could not be prepared in this browser.")

    const data = await toBareBase64(blob)
    if (data.length > BUILDER_REFERENCE_IMAGE_MAX_BASE64) {
      // Pathological input: even a 1568px q0.85 JPEG didn't fit. Name the real
      // problem rather than surface the route's generic rejection — `attach()`
      // in ChatPane renders this message as a visible red line.
      throw new Error("That image is too complex to send as a reference, even after shrinking it. Try a simpler image or crop it down.")
    }

    return {
      mediaType: "image/jpeg",
      data,
      name: file.name || "reference",
      bytes: blob.size,
    }
  } finally {
    bitmap.close()
  }
}
