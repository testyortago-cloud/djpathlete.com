import { createServiceRoleClient } from "@/lib/supabase"

const BUCKET = "blog-images"

export async function uploadBlogImage(file: File | Blob, path: string): Promise<string> {
  const supabase = createServiceRoleClient()

  await supabase.storage.from(BUCKET).remove([path])

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })

  if (error) throw new Error(`Blog image upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function deleteBlogImage(path: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove([path])
}
