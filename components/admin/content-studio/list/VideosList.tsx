import Link from "next/link"
import type { VideoUpload } from "@/types/database"
import { Film } from "lucide-react"

interface VideosListProps {
  videos: VideoUpload[]
}

function formatDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function VideosList({ videos }: VideosListProps) {
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
      <table className="w-full text-sm">
        <thead className="bg-surface/40 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Filename</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Duration</th>
            <th className="px-4 py-2">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id} className="border-t border-border hover:bg-surface/30">
              <td className="px-4 py-2">
                <Link
                  href={`/admin/content/${v.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {v.title ?? v.original_filename}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{v.original_filename}</td>
              <td className="px-4 py-2">{v.status}</td>
              <td className="px-4 py-2">{formatDuration(v.duration_seconds)}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {new Date(v.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
