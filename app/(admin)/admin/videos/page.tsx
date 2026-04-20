// app/(admin)/admin/videos/page.tsx
import { VideosPageClient } from "@/components/admin/videos/VideosPageClient"
import { listVideoUploads } from "@/lib/db/video-uploads"
import type { VideoUpload } from "@/types/database"

export const metadata = { title: "Videos" }

export default async function VideosPage() {
  const videos: VideoUpload[] = await listVideoUploads({ limit: 50 })
  return <VideosPageClient initialVideos={videos} />
}
