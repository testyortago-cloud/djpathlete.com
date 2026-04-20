import { Upload, CheckCircle, Film } from "lucide-react"
import { listVideoUploads } from "@/lib/db"
import type { VideoUpload } from "@/types/database"

export const metadata = { title: "Videos" }

export default async function VideosPage() {
  const videos = (await listVideoUploads()) as VideoUpload[]

  const processing = videos.filter(
    (v) => v.status === "uploaded" || v.status === "transcribing",
  ).length
  const ready = videos.filter(
    (v) => v.status === "transcribed" || v.status === "analyzed",
  ).length
  const total = videos.length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Videos</h1>
          <p className="text-sm text-muted-foreground">
            Upload coaching footage once — we generate captions, thumbnails, and schedule them
            across every connected platform.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="text-xs px-3 py-1.5 rounded-md bg-primary/5 text-muted-foreground cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Video upload ships in Phase 3"
        >
          Upload video
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
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
            <p className="text-lg sm:text-2xl font-semibold text-primary">{total}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Film className="size-5 text-primary" />
          <h2 className="font-semibold text-primary">No videos uploaded yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Video upload ships in Phase 3. Connect your platforms now so captions go live the moment
          upload opens.
        </p>
      </div>
    </div>
  )
}
