import { createServiceRoleClient } from "@/lib/supabase"

const BUCKET = "event-images"

export async function uploadEventImage(file: File | Blob, path: string): Promise<string> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove([path])
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  })
  if (error) throw new Error(`Event image upload failed: ${error.message}`)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function deleteEventImage(path: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase.storage.from(BUCKET).remove([path])
}
