"use client"

import { Film, Upload, CheckCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { VideoUploader } from "./VideoUploader"
import { VideoListCard } from "./VideoListCard"
import type { VideoUpload } from "@/types/database"

interface VideosPageClientProps {
  initialVideos: VideoUpload[]
}

export function VideosPageClient({ initialVideos }: VideosPageClientProps) {
  const router = useRouter()
  // Read directly from props — router.refresh() re-renders with fresh data.
  // A local useState() would cache the first value and ignore subsequent refreshes.
  const videos = initialVideos

  const processing = videos.filter((v) => v.status === "uploaded" || v.status === "transcribing").length
  const ready = videos.filter((v) => v.status === "transcribed" || v.status === "analyzed").length

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Videos</h1>
          <p className="text-sm text-muted-foreground">
            Upload coaching footage once — we generate captions across every connected platform.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mt-6 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Upload className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Processing</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{processing}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Ready</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{ready}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Film className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{videos.length}</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <VideoUploader
          onUploaded={() => {
            router.refresh()
          }}
        />
      </div>

      {videos.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-6 text-center">
          <Film className="size-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No videos uploaded yet — upload one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <VideoListCard
              key={video.id}
              video={video}
              onAction={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
