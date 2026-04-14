import { createServiceRoleClient } from "@/lib/supabase"

const BUCKET = "avatars"

/**
 * Upload an avatar image for a user. Overwrites any existing avatar.
 * Returns the public URL of the uploaded image.
 */
export async function uploadAvatar(userId: string, file: File | Blob, fileName?: string): Promise<string> {
  const supabase = createServiceRoleClient()
  const ext = fileName?.split(".").pop() ?? "jpg"
  const path = `${userId}.${ext}`

  // Remove old avatar first (ignore errors if it doesn't exist)
  await supabase.storage.from(BUCKET).remove([path])

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })

  if (error) throw new Error(`Avatar upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  // Append cache-buster so browsers pick up the new image
  return `${data.publicUrl}?v=${Date.now()}`
}

/**
 * Delete a user's avatar from storage.
 */
export async function deleteAvatar(userId: string): Promise<void> {
  const supabase = createServiceRoleClient()

  // Try common extensions — we store as {userId}.{ext}
  const extensions = ["jpg", "jpeg", "png", "webp", "gif"]
  const paths = extensions.map((ext) => `${userId}.${ext}`)

  await supabase.storage.from(BUCKET).remove(paths)
}
