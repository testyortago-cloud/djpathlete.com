// app/(admin)/admin/videos/page.tsx
import { redirect } from "next/navigation"
import { VideosPageClient } from "@/components/admin/videos/VideosPageClient"
import { listVideoUploads } from "@/lib/db/video-uploads"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
import type { VideoUpload } from "@/types/database"

export const metadata = { title: "Videos" }

export default async function VideosPage() {
  if (isContentStudioEnabled()) {
    redirect("/admin/content?tab=videos")
  }
  const videos: VideoUpload[] = await listVideoUploads({ limit: 50 })
  return <VideosPageClient initialVideos={videos} />
}
