import { auth } from "@/lib/auth"
import {
  getPreferences as dalGet,
  upsertPreferences as dalUpsert,
  type PreferencesPatch,
} from "@/lib/db/user-preferences"
import type { UserPreferences } from "@/types/database"

export async function readPreferences(): Promise<UserPreferences | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  try {
    return await dalGet(session.user.id)
  } catch (err) {
    // Never let a preference-read failure crash the Content Studio page —
    // callers treat null as "fall back to hard-coded defaults".
    console.error("[readPreferences] failed:", err)
    return null
  }
}

export async function writePreferences(patch: PreferencesPatch): Promise<UserPreferences | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return dalUpsert(session.user.id, patch)
}
