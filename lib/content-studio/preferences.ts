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
  return dalGet(session.user.id)
}

export async function writePreferences(
  patch: PreferencesPatch,
): Promise<UserPreferences | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  return dalUpsert(session.user.id, patch)
}
