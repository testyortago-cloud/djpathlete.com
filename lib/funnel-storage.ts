// lib/funnel-storage.ts — images for funnel pages, in Firebase Storage.
//
// ---------------------------------------------------------------------------
// THIS RETURNS A DURABLE PUBLIC URL, AND THAT IS THE WHOLE CONSTRAINT.
// ---------------------------------------------------------------------------
// Every other Firebase asset in this app is private and signed lazily at read
// time (`lib/messaging/storage.ts`, `lib/content-studio/asset-thumbnails.ts`,
// the media-assets flow, which stores the storage PATH as `public_url` and
// signs on demand). None of that works here.
//
// A funnel page's `hero.media.src` is written into the `SectionDoc`, compiled
// into the published HTML, and stored on an immutable `funnel_step_versions`
// row. It is then served to ANONYMOUS VISITORS, for as long as that version is
// live. A signed URL in that position expires and the hero image silently
// disappears from a running campaign page — and because `safeUrl` drops a bad
// `src` with no warning, the failure would show up as a broken image and
// nothing else. See the repo's `signed_urls_durable_hrefs` rule: signed GCS
// URLs must never be durable hrefs.
//
// So funnel images are PUBLIC objects under a path `storage.rules` marks
// readable, addressed by the Firebase download URL, which never expires.
// `storage.rules` deploys from this repo via the deploy-firebase-rules
// workflow, so the permission and the code that depends on it ship together.
//
// Uploads use the ADMIN SDK, which bypasses `storage.rules` entirely — the
// matching rule grants `read` only, and `write: if false` is deliberate: no
// browser may ever put a file here directly.

import { getAdminStorage } from "@/lib/firebase-admin"

/** Matches the `match /funnel-images/{stepId}/{fileName}` rule in storage.rules. */
export const FUNNEL_IMAGE_PREFIX = "funnel-images"

/**
 * The public, non-expiring URL for an object in the default bucket.
 *
 * The path is percent-encoded WHOLE, slashes included (`%2F`) — that is the
 * form the Firebase download endpoint requires, and encoding the segments
 * individually produces a URL that 404s.
 */
export function funnelImagePublicUrl(bucketName: string, storagePath: string): string {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media`
  )
}

export interface UploadedFunnelImage {
  storagePath: string
  /** Durable and public. Safe to write into a published document. */
  url: string
}

/**
 * Uploads one image and returns its durable public URL.
 *
 * `stepId` scopes the path so a page's images are findable and deletable as a
 * group, and so the `storage.rules` match is as narrow as it can be.
 */
export async function uploadFunnelImage(
  file: File | Blob,
  stepId: string,
  filename: string,
): Promise<UploadedFunnelImage> {
  const bucket = getAdminStorage().bucket()
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  const storagePath = `${FUNNEL_IMAGE_PREFIX}/${stepId}/${crypto.randomUUID()}-${safe}`

  const buffer = Buffer.from(await file.arrayBuffer())
  await bucket.file(storagePath).save(buffer, {
    contentType: file.type || "image/jpeg",
    // The object is world-readable by rule; this only stops CDNs and browsers
    // caching it forever under a path that could later be replaced.
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  })

  return { storagePath, url: funnelImagePublicUrl(bucket.name, storagePath) }
}
