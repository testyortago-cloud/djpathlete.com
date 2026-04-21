// One-off: delete all video blobs (+ thumbnail siblings) from the Firebase
// Storage bucket. Takes the list of paths from an env arg so this script
// itself doesn't query Supabase — avoids coupling.
//
// Usage:
//   npx tsx scripts/clear-content-studio.ts "path1" "path2" "path3"

import { config } from "dotenv"
config({ path: ".env.local" })
import { getAdminStorage } from "@/lib/firebase-admin"

async function main() {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error("No paths given. Usage: npx tsx scripts/clear-content-studio.ts <path> [<path> ...]")
    process.exit(1)
  }

  const bucket = getAdminStorage().bucket()
  console.log(`Bucket: ${bucket.name}`)

  for (const storagePath of paths) {
    const targets = [storagePath, `${storagePath}.thumb.jpg`]
    for (const target of targets) {
      try {
        const file = bucket.file(target)
        const [exists] = await file.exists()
        if (!exists) {
          console.log(`  skip (missing): ${target}`)
          continue
        }
        await file.delete({ ignoreNotFound: true })
        console.log(`  deleted:        ${target}`)
      } catch (err) {
        console.error(`  failed:         ${target} — ${(err as Error).message}`)
      }
    }
  }

  console.log("Done.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
