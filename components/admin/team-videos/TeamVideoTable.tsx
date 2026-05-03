"use client"

import { useState } from "react"
import Link from "next/link"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

const ALL: TeamVideoSubmissionStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "revision_requested",
  "approved",
  "locked",
]

const STATUS_LABEL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  revision_requested: "Revision requested",
  approved: "Approved",
  locked: "Sent to Content Studio",
}

const STATUS_PILL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-warning/10 text-warning border-warning/30",
  in_review: "bg-warning/10 text-warning border-warning/30",
  revision_requested: "bg-error/10 text-error border-error/30",
  approved: "bg-success/10 text-success border-success/30",
  locked: "bg-muted text-muted-foreground border-border",
}

export function TeamVideoTable({ submissions }: { submissions: TeamVideoSubmission[] }) {
  const [filter, setFilter] = useState<TeamVideoSubmissionStatus | "all">("all")
  const filtered =
    filter === "all" ? submissions : submissions.filter((s) => s.status === filter)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs ${
            filter === "all" ? "border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          All ({submissions.length})
        </button>
        {ALL.map((status) => {
          const count = submissions.filter((s) => s.status === status).length
          if (count === 0) return null
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-full border px-3 py-1 text-xs ${
                filter === status ? "border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {STATUS_LABEL[status]} ({count})
            </button>
          )
        })}
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={3}>
                  No videos in this view.
                </td>
              </tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/team-videos/${s.id}`}
                    className="font-medium hover:underline"
                  >
                    {s.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_PILL[s.status]}`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(s.updated_at).toLocaleDateString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
