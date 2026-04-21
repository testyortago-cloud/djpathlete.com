import Link from "next/link"
import { Megaphone } from "lucide-react"
import type { PipelinePostRow } from "@/lib/db/social-posts"

interface PostsListProps {
  posts: PipelinePostRow[]
}

export function PostsList({ posts }: PostsListProps) {
  if (posts.length === 0) {
    return (
      <div className="py-16 text-center">
        <Megaphone className="size-8 text-muted-foreground mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No posts yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface/40 text-left">
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2">Platform</th>
            <th className="px-4 py-2">Caption</th>
            <th className="px-4 py-2">Source video</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} className="border-t border-border hover:bg-surface/30">
              <td className="px-4 py-2 text-muted-foreground">{p.platform}</td>
              <td className="px-4 py-2">
                <Link href={`/admin/content/post/${p.id}`} className="text-primary hover:underline line-clamp-2">
                  {p.content}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{p.source_video_filename ?? "—"}</td>
              <td className="px-4 py-2">{p.approval_status}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
