import type { VideoUpload } from "@/types/database"
import { GenerateQuoteCardsButton } from "@/components/admin/content-studio/drawer/GenerateQuoteCardsButton"
import { SplitReelPanel } from "@/components/admin/content-studio/drawer/SplitReelPanel"

interface VideoDetailSidebarProps {
  video: VideoUpload
  previewUrl: string | null
  hasTranscript?: boolean
  splitReelEnabled?: boolean
  reelEditorEnabled?: boolean
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—"
  const mb = bytes / 1_000_000
  if (mb < 1) return `${(bytes / 1_000).toFixed(0)} KB`
  if (mb < 1_000) return `${mb.toFixed(1)} MB`
  return `${(mb / 1_000).toFixed(2)} GB`
}

export function VideoDetailSidebar({
  video,
  previewUrl,
  hasTranscript = false,
  splitReelEnabled = false,
  reelEditorEnabled = false,
}: VideoDetailSidebarProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        {previewUrl ? (
          <video src={previewUrl} controls preload="metadata" className="w-full aspect-video bg-black">
            Your browser does not support the video element.
          </video>
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
            Preview unavailable
          </div>
        )}
      </div>

      <div>
        <p className="font-mono text-xs text-muted-foreground truncate" title={video.original_filename}>
          {video.original_filename}
        </p>
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd className="text-primary">{new Date(video.created_at).toLocaleDateString()}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="text-primary tabular-nums">{formatDuration(video.duration_seconds)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Size</dt>
            <dd className="text-primary tabular-nums">{formatSize(video.size_bytes)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <GenerateQuoteCardsButton videoUploadId={video.id} hasTranscript={hasTranscript} />
      </div>

      {splitReelEnabled && (
        <SplitReelPanel
          videoUploadId={video.id}
          hasTranscript={hasTranscript}
          reelEditorEnabled={reelEditorEnabled}
        />
      )}
    </div>
  )
}
