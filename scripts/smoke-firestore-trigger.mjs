/**
 * Firestore-trigger smoke test for the local Firebase emulator.
 *
 * Writes one `ai_jobs` doc with an UNRECOGNIZED `type`, so every
 * onDocumentCreated("ai_jobs/{jobId}") trigger (programGeneration, programChat,
 * blogGeneration, …) fires its guard and returns immediately — proving the
 * trigger plumbing works with ZERO AI spend and ZERO Supabase writes.
 *
 * Run it under the emulator so it inherits FIRESTORE_EMULATOR_HOST:
 *
 *     npm --prefix functions run build   # ensure dist/ is current
 *     npm run smoke:trigger              # boots emulators, runs this, tears down
 *
 * Watch the emulator output for lines like:
 *     functions: Beginning execution of "us-central1-programGeneration"
 */
import { initializeApp, getApps } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host) {
  console.error(
    "✗ FIRESTORE_EMULATOR_HOST is not set. Run this via `npm run smoke:trigger` " +
      "(firebase emulators:exec sets it) — never against production.",
  )
  process.exit(1)
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "darrenjpaulcom"
if (!getApps().length) initializeApp({ projectId })
const db = getFirestore()

const marker = `smoke-${Date.now()}`
console.log(`→ Firestore emulator at ${host} (project ${projectId})`)
console.log(`→ Writing ai_jobs doc with type "__smoke_test__" (marker: ${marker})`)

const ref = await db.collection("ai_jobs").add({
  type: "__smoke_test__",
  marker,
  status: "queued",
  createdAt: FieldValue.serverTimestamp(),
})

console.log(`✓ Wrote ai_jobs/${ref.id}`)
console.log("→ Waiting 5s for the functions emulator to dispatch the trigger…")
await new Promise((r) => setTimeout(r, 5000))

// Confirm the doc is readable back through the emulator (round-trip sanity check).
const snap = await ref.get()
if (snap.exists && snap.get("marker") === marker) {
  console.log("✓ Round-trip read OK — emulator Firestore is live and writable.")
} else {
  console.error("✗ Could not read the doc back from the emulator.")
  process.exit(1)
}

// Clean up so repeated runs don't pile up docs.
await ref.delete()
console.log(`✓ Cleaned up ai_jobs/${ref.id}`)
console.log(
  '\nTrigger fired if the emulator log shows: Beginning execution of "...-programGeneration" (and the other ai_jobs triggers).',
)
