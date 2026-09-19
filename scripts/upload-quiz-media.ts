// Uploads a quiz's movement-demo clips and poster frames to Firebase Storage.
//
// Run with: npx tsx scripts/upload-quiz-media.ts <local-dir> [quizKey]
//
// WHY THESE OBJECTS ARE PUBLIC-BY-RULE RATHER THAN SIGNED. A quiz question's
// `media_url` is served to anonymous visitors walking the quiz on a published
// funnel page, for as long as that quiz is active. A signed URL in that
// position expires and the demo video silently disappears mid-campaign — the
// same constraint `lib/funnel-storage.ts` documents for a funnel hero image,
// and the same answer: a durable Firebase download URL under a path that
// `storage.rules` marks readable.
//
// The matching rule is `match /quiz-media/{quizKey}/{fileName}`, which grants
// READ only. Writes never happen through it — this script uses the Admin SDK,
// which bypasses storage.rules entirely. That rule ships from this repo via
// the deploy-firebase-rules workflow, so the permission and the code that
// depends on it land together.
//
// NOTE: there is ONE Firebase project for this app (`darrenjpaulcom`); both
// .env.local and .env.prod name it. This writes to the live bucket either way.
import { config } from "dotenv"
config({ path: ".env.local" })
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getAdminStorage } from "@/lib/firebase-admin"
import { quizMediaPublicUrl, quizMediaStoragePath } from "@/lib/quiz-media-storage"

const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg" }

async function main() {
  const dir = process.argv[2]
  const quizKey = process.argv[3] ?? "rotational-reboot"
  if (!dir) throw new Error("Usage: npx tsx scripts/upload-quiz-media.ts <local-dir> [quizKey]")

  const bucket = getAdminStorage().bucket()
  const names = readdirSync(dir)
    .filter((name) => Object.keys(CONTENT_TYPES).some((ext) => name.endsWith(ext)))
    .sort()
  if (names.length === 0) throw new Error(`No .mp4/.jpg files in ${dir}`)

  console.log(`Uploading ${names.length} file(s) to gs://${bucket.name}/${quizMediaStoragePath(quizKey, "")}\n`)

  const urls: Record<string, string> = {}
  for (const name of names) {
    const bytes = readFileSync(join(dir, name))
    const storagePath = quizMediaStoragePath(quizKey, name)
    const ext = name.slice(name.lastIndexOf("."))
    await bucket.file(storagePath).save(bytes, {
      contentType: CONTENT_TYPES[ext],
      // Immutable: the filename carries the test's slug and is never rewritten
      // in place — a re-cut ships under a new name so caches cannot serve the
      // old clip against the new question.
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    })
    urls[name] = quizMediaPublicUrl(bucket.name, storagePath)
    console.log(`  ✓ ${String((bytes.length / 1024).toFixed(0)).padStart(5)} KB  ${name}`)
  }

  const manifest = join(dir, "urls.json")
  writeFileSync(manifest, `${JSON.stringify(urls, null, 2)}\n`)
  console.log(`\nWrote ${manifest}`)
  console.log("These URLs 404 until storage.rules reaches main (deploy-firebase-rules workflow).")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
