// lib/content-studio/asset-thumbnails.ts
// Server-side helper that generates short-lived signed READ URLs for a list
// of image assets, so the admin asset library can render thumbnails without
// re-signing per row on the client. Caps at MAX_SIGNED to avoid burning
// storage quota on huge libraries — beyond that, assets render without a
// preview and a real pagination layer can land later.

import { getAdminStorage } from "@/lib/firebase-admin"
import type { AssetWithPostCount } from "@/lib/db/media-assets"

const SIGNED_URL_TTL_MS = 60 * 60 * 1000
const MAX_SIGNED = 200

export async function signImageAssetThumbnails(
  assets: AssetWithPostCount[],
): Promise<Record<string, string>> {
  const imageAssets = assets.filter((a) => a.kind === "image").slice(0, MAX_SIGNED)
  if (imageAssets.length === 0) return {}

  const bucket = getAdminStorage().bucket()
  const results = await Promise.all(
    imageAssets.map(async (asset) => {
      try {
        const [url] = await bucket.file(asset.storage_path).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return [asset.id, url] as const
      } catch {
        // A missing or inaccessible file shouldn't block the whole page — skip.
        return [asset.id, null] as const
      }
    }),
  )

  const out: Record<string, string> = {}
  for (const [id, url] of results) {
    if (url) out[id] = url
  }
  return out
}
