import Link from "next/link"
import type { VideoUpload } from "@/types/database"
import { Film } from "lucide-react"
import type { PostCounts } from "@/lib/content-studio/pipeline-data"
import { VideoRowActions } from "./VideoRowActions"

interface VideosListProps {
  videos: VideoUpload[]
  postCountsByVideo?: Record<string, PostCounts>
}

function formatDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function VideosList({ videos, postCountsByVideo }: VideosListProps) {
  if (videos.length === 0) {
    return (
      <div className="py-16 text-center">
        <Film className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No videos yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead className="bg-surface/40 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 w-[26%]">Title</th>
            <th className="px-4 py-2 w-[28%]">Filename</th>
            <th className="px-4 py-2 w-[10%]">Status</th>
            <th className="px-4 py-2 w-[8%]">Duration</th>
            <th className="px-4 py-2 w-[10%]">Uploaded</th>
            <th className="px-4 py-2 w-[18%] text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => {
            const title = v.title ?? v.original_filename
            return (
              <tr key={v.id} className="border-t border-border hover:bg-surface/30">
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/content/${v.id}`}
                    className="block text-primary font-medium hover:underline truncate"
                    title={title}
                  >
                    {title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  <span className="block truncate" title={v.original_filename}>
                    {v.original_filename}
                  </span>
                </td>
                <td className="px-4 py-2">{v.status}</td>
                <td className="px-4 py-2">{formatDuration(v.duration_seconds)}</td>
                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(v.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2">
                  <VideoRowActions video={v} postCount={postCountsByVideo?.[v.id]?.total ?? 0} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
