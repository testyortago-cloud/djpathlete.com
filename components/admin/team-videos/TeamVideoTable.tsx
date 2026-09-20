"use client"

import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { unsentFeedback } from "@/lib/team-videos/workflow"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

const ALL: TeamVideoSubmissionStatus[] = ["draft", "submitted", "in_review", "revision_requested", "approved", "locked"]

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

interface Props {
  submissions: TeamVideoSubmission[]
  /**
   * Open notes on each submission's current cut, keyed by submission id.
   * Drives the "notes not sent" flag — a submission can sit for weeks with
   * feedback the editor was never told about.
   */
  openNotes?: Record<string, number>
}

export function TeamVideoTable({ submissions, openNotes = {} }: Props) {
  const [filter, setFilter] = useState<TeamVideoSubmissionStatus | "all">("all")
  const filtered = filter === "all" ? submissions : submissions.filter((s) => s.status === filter)

  const stuck = useMemo(
    () =>
      submissions.filter(
        (s) =>
          unsentFeedback({
            status: s.status,
            openCommentsOnCurrentVersion: openNotes[s.id] ?? 0,
          }).unsent,
      ),
    [submissions, openNotes],
  )

  return (
    <div className="space-y-4">
      {stuck.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.5} />
          <p className="font-body text-sm text-warning">
            <span className="font-medium">
              {stuck.length === 1
                ? "1 submission has notes you haven't sent"
                : `${stuck.length} submissions have notes you haven't sent`}
            </span>{" "}
            <span className="text-muted-foreground">
              — open {stuck.length === 1 ? "it" : "them"} and hit &quot;Send notes to editor&quot; so a new version can
              land.
            </span>
          </p>
        </div>
      )}
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

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Title</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Updated</DataTableHead>
          </DataTableHeader>
          <tbody>
            {filtered.length === 0 && (
              <DataTableRow>
                <DataTableCell muted colSpan={3} className="py-6 text-center">
                  No videos in this view.
                </DataTableCell>
              </DataTableRow>
            )}
            {filtered.map((s) => (
              <DataTableRow key={s.id} className="hover:bg-muted/40">
                <DataTableCell>
                  <Link href={`/admin/team-media/${s.id}`} className="font-medium hover:underline">
                    {s.title}
                  </Link>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                      s.kind === "image_set" ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {s.kind === "image_set" ? "Photos" : "Video"}
                  </span>
                </DataTableCell>
                <DataTableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_PILL[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                    {unsentFeedback({
                      status: s.status,
                      openCommentsOnCurrentVersion: openNotes[s.id] ?? 0,
                    }).unsent && (
                      <span
                        className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-warning"
                        title="You've left notes on this cut but your editor hasn't been notified"
                      >
                        Notes not sent
                      </span>
                    )}
                  </div>
                </DataTableCell>
                <DataTableCell muted>{new Date(s.updated_at).toLocaleDateString("en-US")}</DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
