import { initializeApp, getApps, cert, type App } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"
import { getFirestore } from "firebase-admin/firestore"
import { getDatabase } from "firebase-admin/database"

let app: App

export function getAdminApp() {
  if (!app) {
    if (getApps().length) {
      app = getApps()[0]
    } else {
      // Route the Admin SDK at the local emulators when the toggle is on (set by
      // `npm run dev:emu`). The SDK auto-detects these *_EMULATOR_HOST vars.
      if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true") {
        process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080"
        process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= "127.0.0.1:9000"
        process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199"
      }
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")
      app = initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
      })
    }
  }
  return app
}

export function getAdminStorage() {
  return getStorage(getAdminApp())
}

/**
 * Bucket for private shop downloads (signed URLs only).
 * Name comes from FIREBASE_PRIVATE_BUCKET.
 */
export function getPrivateBucket() {
  const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
  if (!bucketName) throw new Error("FIREBASE_PRIVATE_BUCKET not set")
  return getStorage(getAdminApp()).bucket(bucketName)
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp())
}

export function getAdminRtdb() {
  return getDatabase(getAdminApp())
}

/**
 * Generate a signed URL for a Firebase Storage file.
 * Defaults to 1-hour expiry.
 */
export async function getSignedVideoUrl(videoPath: string, expiresInMs = 60 * 60 * 1000): Promise<string> {
  const bucket = getAdminStorage().bucket()
  const file = bucket.file(videoPath)
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + expiresInMs,
  })
  return url
}
