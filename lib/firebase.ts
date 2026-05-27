import { initializeApp, getApps, getApp } from "firebase/app"
import { getStorage, connectStorageEmulator } from "firebase/storage"
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore"
import { getDatabase, connectDatabaseEmulator } from "firebase/database"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
}

const isNewApp = getApps().length === 0
const app = isNewApp ? initializeApp(firebaseConfig) : getApp()
export const storage = getStorage(app)
export const db = getFirestore(app)
export const rtdb = getDatabase(app)

// Point the browser SDK at the local Firebase emulators when the toggle is on
// (set by `npm run dev:emu`). Only wire on first init to avoid re-connect errors.
if (isNewApp && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080)
  connectDatabaseEmulator(rtdb, "127.0.0.1", 9000)
  connectStorageEmulator(storage, "127.0.0.1", 9199)
}
