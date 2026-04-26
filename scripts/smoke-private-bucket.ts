// One-off smoke test for the FIREBASE_PRIVATE_BUCKET roundtrip.
// Run with: npx tsx scripts/smoke-private-bucket.ts
import { config } from "dotenv"
config({ path: ".env.local" })
import { generateSignedDownloadUrl, generateSignedUploadUrl } from "@/lib/shop/downloads"
import { getPrivateBucket } from "@/lib/firebase-admin"
import crypto from "node:crypto"

async function main() {
  const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
  if (!bucketName) throw new Error("FIREBASE_PRIVATE_BUCKET not set")
  console.log(`[1/6] Target bucket: ${bucketName}`)

  const bucket = getPrivateBucket()
  const [exists] = await bucket.exists()
  console.log(`[2/6] Bucket exists via admin SDK: ${exists}`)
  if (!exists) throw new Error("bucket not visible to admin SDK")

  const testPath = `smoke-tests/roundtrip-${Date.now()}.txt`
  const testBody = `hello phase-2 ${crypto.randomBytes(8).toString("hex")}`

  console.log(`[3/6] Generating signed upload URL for ${testPath}`)
  const uploadUrl = await generateSignedUploadUrl(testPath, "text/plain", 300)

  console.log(`[4/6] PUT ${testBody.length} bytes`)
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: testBody,
  })
  if (!putRes.ok) {
    console.error("PUT failed", putRes.status, await putRes.text())
    throw new Error(`upload failed: ${putRes.status}`)
  }
  console.log(`        → ${putRes.status} ${putRes.statusText}`)

  console.log(`[5/6] Generating signed download URL`)
  const downloadUrl = await generateSignedDownloadUrl(testPath, 300)
  const getRes = await fetch(downloadUrl)
  if (!getRes.ok) throw new Error(`download failed: ${getRes.status}`)
  const got = await getRes.text()
  console.log(`        → ${got.length} bytes: "${got}"`)

  if (got !== testBody) {
    throw new Error(`roundtrip mismatch: expected "${testBody}" got "${got}"`)
  }
  console.log(`[6/6] ✓ Roundtrip OK — body matches`)

  // Cleanup
  await bucket.file(testPath).delete()
  console.log(`        ✓ Cleaned up test file`)
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e)
  process.exit(1)
})
