import { createServiceRoleClient } from "@/lib/supabase"

// Reuse the existing public "avatars" bucket; testimonial photos live under a
// dedicated path prefix so they don't collide with user profile avatars.
const BUCKET = "avatars"

export async function uploadTestimonialImage(file: File | Blob, path: string): Promise<string> {
  const supabase = createServiceRoleClient()

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })
  if (error) throw new Error(`Testimonial image upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}
