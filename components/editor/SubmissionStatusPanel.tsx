"use client"

import { CheckCircle2, Clock, Lock, MessageSquare, Upload } from "lucide-react"
import type { EditorWorkflowState } from "@/lib/team-videos/workflow"

interface Props {
  state: EditorWorkflowState
  /** Open notes on the cut the editor is being asked to fix. */
  openCommentCount: number
  /** Scrolls / focuses the comment thread. Omitted when there's nothing to read. */
  onViewNotes?: () => void
  /** True once the submission is locked — swaps the icon for a padlock. */
  locked?: boolean
}

const TONE = {
  action: {
    wrap: "border-accent/40 bg-accent/10",
    label: "text-accent",
    Icon: Upload,
  },
  waiting: {
    wrap: "border-border bg-muted/30",
    label: "text-muted-foreground",
    Icon: Clock,
  },
  done: {
    wrap: "border-success/30 bg-success/10",
    label: "text-success",
    Icon: CheckCircle2,
  },
} as const

/**
 * The editor's "where does this stand" card. Renders for EVERY status —
 * previously the page showed nothing at all unless a revision was pending,
 * so an editor with feedback but no formal revision request saw a bare page
 * with no upload zone and no explanation of why.
 */
export function SubmissionStatusPanel({
  state,
  openCommentCount,
  onViewNotes,
  locked = false,
}: Props) {
  const tone = TONE[state.tone]
  const Icon = locked ? Lock : tone.Icon

  return (
    <div className={`rounded-md border p-4 ${tone.wrap}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${tone.label}`} strokeWidth={1.5} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`font-heading text-sm ${tone.label}`}>{state.headline}</p>
          <p className="font-body text-sm text-muted-foreground">{state.detail}</p>

          {openCommentCount > 0 && onViewNotes && (
            <button
              type="button"
              onClick={onViewNotes}
              className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-primary underline-offset-4 hover:underline"
            >
              <MessageSquare className="size-3.5" strokeWidth={1.5} />
              Read {openCommentCount === 1 ? "the note" : `all ${openCommentCount} notes`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
