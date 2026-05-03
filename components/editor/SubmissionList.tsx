"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { TeamVideoSubmission, TeamVideoSubmissionStatus } from "@/types/database"

const STATUS_LABEL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting Darren",
  in_review: "Awaiting Darren",
  revision_requested: "Needs your action",
  approved: "Approved",
  locked: "Sent to Content Studio",
}

const STATUS_PILL: Record<TeamVideoSubmissionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/10 text-warning",
  in_review: "bg-warning/10 text-warning",
  revision_requested: "bg-error/10 text-error",
  approved: "bg-success/10 text-success",
  locked: "bg-muted text-muted-foreground",
}

interface Section {
  title: string
  defaultOpen: boolean
  statuses: TeamVideoSubmissionStatus[]
}

const SECTIONS: Section[] = [
  { title: "Needs your action", defaultOpen: true, statuses: ["revision_requested"] },
  { title: "Awaiting Darren", defaultOpen: true, statuses: ["submitted", "in_review"] },
  { title: "Approved", defaultOpen: false, statuses: ["approved", "locked"] },
  { title: "Drafts", defaultOpen: false, statuses: ["draft"] },
]

export function SubmissionList({ submissions }: { submissions: TeamVideoSubmission[] }) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center">
        <p className="font-body text-sm text-muted-foreground">
          No videos yet. Click &quot;Upload video&quot; to submit your first one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const items = submissions.filter((s) => section.statuses.includes(s.status))
        if (items.length === 0) return null
        return (
          <Section key={section.title} title={section.title} defaultOpen={section.defaultOpen} count={items.length}>
            <ul className="space-y-2">
              {items.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/editor/videos/${s.id}`}
                    className="flex items-center justify-between rounded-md border bg-card p-3 hover:bg-muted/40"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Updated {new Date(s.updated_at).toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )
      })}
    </div>
  )
}

function Section({
  title, defaultOpen, count, children,
}: { title: string; defaultOpen: boolean; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {title} <span className="text-muted-foreground">({count})</span>
      </button>
      {open && children}
    </section>
  )
}
