/**
 * One-off: sign short-lived READ URLs for the quote-card carousel slides of a
 * given social post, so you can open them in a browser and SEE what the
 * "Make post from transcript" flow produced.
 *
 * Run against PRODUCTION storage (this is read-only, just signing URLs):
 *
 *     node --env-file=.env.local scripts/sign-carousel-slides.mjs <social_post_id>
 *
 * Defaults to the known generated post if no id is passed.
 */
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"
import { createClient } from "@supabase/supabase-js"

const postId = process.argv[2] || "9a9d5416-ad47-4805-81fb-a5a89589bf47"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceKey)

const { data, error } = await supabase
  .from("social_post_media")
  .select("position, media_assets(storage_path)")
  .eq("social_post_id", postId)
  .order("position", { ascending: true })
if (error) {
  console.error("✗ Supabase query failed:", error.message)
  process.exit(1)
}
const slides = (data ?? []).map((r) => ({
  position: r.position,
  path: r.media_assets?.storage_path,
}))
if (slides.length === 0) {
  console.error(`✗ No slides attached to post ${postId}`)
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  })
}
const bucket = getStorage().bucket()

console.log(`\nPost ${postId} — ${slides.length} slides:\n`)
for (const slide of slides) {
  const [url] = await bucket.file(slide.path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  })
  console.log(`  slide ${slide.position}: ${url}\n`)
}
console.log("URLs expire in 1 hour. Paste any into a browser to view the quote card.\n")
