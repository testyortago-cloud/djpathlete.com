// lib/team-videos/thumbnails.ts
// Signed READ URLs for the Team Media board, keyed by SUBMISSION id.
//
// A video submission previews its current cut's thumbnail; an image-set
// submission has no video to seek, so it previews its first image. One failed
// signature drops that row's preview and leaves every other row intact — a
// missing blob must never blank the whole board.

import { getAdminStorage } from "@/lib/firebase-admin"
import { isPgMissingColumn } from "@/lib/supabase-errors"
import {
  listCurrentVersionsForSubmissions,
  listFirstImageForSubmissions,
} from "@/lib/db/team-video-submissions"

const SIGNED_URL_TTL_MS = 30 * 60 * 1000

export async function signSubmissionThumbnails(
  submissionIds: string[],
): Promise<Record<string, string>> {
  if (submissionIds.length === 0) return {}

  // listCurrentVersionsForSubmissions reads team_video_versions.thumbnail_path,
  // a column migration 00265 adds. Vercel's build and the migration race on
  // merge to main (see .github/workflows/apply-migrations.yml), so for one
  // deploy this read can hit the pre-00265 schema and get back 42703. That is
  // the ONLY thing tolerated here: previews are decoration and the board is
  // the feature, so a missing column degrades to "no previews yet" instead of
  // a 500. Anything else (permission denied, RLS, PostgREST down) is a real
  // outage and must still surface as one.
  let versions: Awaited<ReturnType<typeof listCurrentVersionsForSubmissions>>
  let firstImages: Awaited<ReturnType<typeof listFirstImageForSubmissions>>
  try {
    ;[versions, firstImages] = await Promise.all([
      listCurrentVersionsForSubmissions(submissionIds),
      listFirstImageForSubmissions(submissionIds),
    ])
  } catch (err) {
    if (!isPgMissingColumn(err)) throw err
    console.warn(
      "signSubmissionThumbnails: team_video_versions.thumbnail_path is missing (migration 00265 pending on this database) — rendering the Team Media board without previews",
      err,
    )
    return {}
  }

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
