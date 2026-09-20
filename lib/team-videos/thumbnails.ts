// lib/team-videos/thumbnails.ts
// Signed READ URLs for the Team Media board, keyed by SUBMISSION id.
//
// A video submission previews its current cut's thumbnail; an image-set
// submission has no video to seek, so it previews its first image. One failed
// signature drops that row's preview and leaves every other row intact — a
// missing blob must never blank the whole board.

import { getAdminStorage } from "@/lib/firebase-admin"
import {
  listCurrentVersionsForSubmissions,
  listFirstImageForSubmissions,
} from "@/lib/db/team-video-submissions"

const SIGNED_URL_TTL_MS = 30 * 60 * 1000

export async function signSubmissionThumbnails(
  submissionIds: string[],
): Promise<Record<string, string>> {
  if (submissionIds.length === 0) return {}

  const [versions, firstImages] = await Promise.all([
    listCurrentVersionsForSubmissions(submissionIds),
    listFirstImageForSubmissions(submissionIds),
  ])

  const wanted: Array<readonly [string, string]> = []
  for (const [submissionId, version] of versions) {
    const path =
      version.kind === "image_set"
        ? firstImages.get(submissionId)
        : version.thumbnail_path
    if (path) wanted.push([submissionId, path] as const)
  }

  const bucket = getAdminStorage().bucket()
  const signed = await Promise.all(
    wanted.map(async ([submissionId, path]) => {
      try {
        const [url] = await bucket.file(path).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_URL_TTL_MS,
        })
        return [submissionId, url] as const
      } catch {
        return null
      }
    }),
  )

  const out: Record<string, string> = {}
  for (const entry of signed) {
    if (entry) out[entry[0]] = entry[1]
  }
  return out
}
