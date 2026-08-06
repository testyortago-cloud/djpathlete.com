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

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"]

/** Same bucket as avatars, prefixed so a report photo never collides with one. */
function reportPhotoPath(userId: string, ext: string): string {
  return `report/${userId}.${ext}`
}

/**
 * Upload the cover photo for a client's public test report. Kept separate from
 * the avatar because the avatar is a small headshot used across the whole app,
 * while this is a full-bleed action shot chosen for one document.
 * Returns the public URL.
 */
export async function uploadReportPhoto(userId: string, file: File | Blob, fileName?: string): Promise<string> {
  const supabase = createServiceRoleClient()
  const ext = (fileName?.split(".").pop() ?? "jpg").toLowerCase()
  const path = reportPhotoPath(userId, ext)

  // Clear every extension first: re-uploading a PNG over a JPG would otherwise
  // leave the JPG behind and the stored URL could still resolve to the old one.
  await supabase.storage.from(BUCKET).remove(IMAGE_EXTENSIONS.map((e) => reportPhotoPath(userId, e)))

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })
  if (error) throw new Error(`Report photo upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

/** Remove a client's report cover photo from storage. */
export async function deleteReportPhoto(userId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove(IMAGE_EXTENSIONS.map((e) => reportPhotoPath(userId, e)))
}
