import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

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
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Platform</DataTableHead>
          <DataTableHead>Caption</DataTableHead>
          <DataTableHead>Source video</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          <DataTableHead>Scheduled</DataTableHead>
        </DataTableHeader>
        <tbody>
          {posts.map((p) => (
            <DataTableRow key={p.id}>
              <DataTableCell muted>{p.platform}</DataTableCell>
              <DataTableCell>
                <Link href={`/admin/content/post/${p.id}`} className="text-primary hover:underline line-clamp-2">
                  {p.content}
                </Link>
              </DataTableCell>
              <DataTableCell muted>{p.source_video_filename ?? "—"}</DataTableCell>
              <DataTableCell>{p.approval_status}</DataTableCell>
              <DataTableCell muted>{p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "—"}</DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
