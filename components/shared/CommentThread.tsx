"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  CheckCircle2,
  RotateCw,
  MessageSquare,
  MapPin,
  Pencil,
  ArrowUpRight,
  Square,
  Trash2,
  CornerDownRight,
  Send,
} from "lucide-react"
import type {
  TeamVideoCommentWithAnnotation,
  DrawingPath,
} from "@/types/database"

function fmtTime(s: number | null): string {
  if (s == null) return "General"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, "0")
  return `${m}:${sec}`
}

function summariseDrawing(paths: DrawingPath[]) {
  if (paths.length === 0) return null
  const counts: Record<string, number> = {}
  for (const p of paths) counts[p.tool] = (counts[p.tool] ?? 0) + 1
  const primaryTool = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as DrawingPath["tool"]
  return { count: paths.length, tool: primaryTool, color: paths[0].color }
}

const TOOL_ICON = {
  pin: MapPin,
  pen: Pencil,
  arrow: ArrowUpRight,
  rectangle: Square,
} as const

const ROLE_PILL: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  editor: "bg-accent/15 text-accent",
}

interface Props {
  comments: TeamVideoCommentWithAnnotation[]
  /** When true, show resolve/reopen actions. */
  canWrite: boolean
  onResolve?: (commentId: string) => void
  onReopen?: (commentId: string) => void
  onJumpTo?: (timecodeSeconds: number) => void
  /** When provided, a Trash button appears on each row. Two-click confirm. */
  onDelete?: (commentId: string) => void
  /** When provided, a Reply composer can be opened on each top-level comment. */
  onReply?: (input: { parentId: string; commentText: string }) => Promise<void> | void
  /** Currently displayed version's number — used to dim cross-version comments. */
  currentVersionNumber?: number | null
  /** When provided, clicking a comment from a different version switches the
   *  player to that version (and seeks). Falls back to onJumpTo otherwise. */
  onJumpToVersion?: (input: { versionNumber: number; timecodeSeconds: number }) => void
}

export function CommentThread({
  comments,
  canWrite,
  onResolve,
  onReopen,
  onJumpTo,
  onDelete,
  onReply,
  currentVersionNumber,
  onJumpToVersion,
}: Props) {
  const [showResolved, setShowResolved] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  // Group comments into top-level + replies-by-parent. Existing DAL ordering
  // (timecode asc, then created asc) keeps each parent before its replies and
  // replies in chronological order.
  const { topLevel, repliesByParent } = useMemo(() => {
    const top: TeamVideoCommentWithAnnotation[] = []
    const byParent = new Map<string, TeamVideoCommentWithAnnotation[]>()
    for (const c of comments) {
      if (c.parent_id) {
        const arr = byParent.get(c.parent_id) ?? []
        arr.push(c)
        byParent.set(c.parent_id, arr)
      } else {
        top.push(c)
      }
    }
    return { topLevel: top, repliesByParent: byParent }
  }, [comments])

  const open = topLevel.filter((c) => c.status === "open")
  const resolved = topLevel.filter((c) => c.status === "resolved")

  function handleDeleteClick(e: React.MouseEvent, commentId: string) {
    e.stopPropagation()
    if (confirmingId === commentId) {
      onDelete?.(commentId)
      setConfirmingId(null)
    } else {
      setConfirmingId(commentId)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="font-medium">{open.length} open</span>
        {resolved.length > 0 && (
          <span className="text-muted-foreground">· {resolved.length} resolved</span>
        )}
      </div>

      {open.length === 0 && resolved.length === 0 && (
        <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No comments yet.
        </p>
      )}

      <ul className="space-y-2">
        {open.map((c) => {
          const replies = repliesByParent.get(c.id) ?? []
          return (
            <CommentRow
              key={c.id}
              comment={c}
              replies={replies}
              canWrite={canWrite}
              confirmingId={confirmingId}
              canReply={Boolean(onReply)}
              currentVersionNumber={currentVersionNumber ?? null}
              onJumpTo={onJumpTo}
              onJumpToVersion={onJumpToVersion}
              onResolve={onResolve}
              onDeleteClick={onDelete ? handleDeleteClick : undefined}
              onReplyOpen={() => setReplyingTo(c.id)}
              onReplyCancel={() => setReplyingTo(null)}
              onReplySubmit={async (text) => {
                if (!onReply) return
                await onReply({ parentId: c.id, commentText: text })
                setReplyingTo(null)
              }}
              showReplyComposer={replyingTo === c.id && Boolean(onReply)}
            />
          )
        })}
      </ul>

      {resolved.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="space-y-2">
              {resolved.map((c) => {
                const replies = repliesByParent.get(c.id) ?? []
                return (
                  <ResolvedRow
                    key={c.id}
                    comment={c}
                    replies={replies}
                    canWrite={canWrite}
                    confirmingId={confirmingId}
                    onReopen={onReopen}
                    onDeleteClick={onDelete ? handleDeleteClick : undefined}
                  />
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Sub-pieces ----

function CommentRow({
  comment: c,
  replies,
  canWrite,
  confirmingId,
  canReply,
  currentVersionNumber,
  onJumpTo,
  onJumpToVersion,
  onResolve,
  onDeleteClick,
  onReplyOpen,
  onReplyCancel,
  onReplySubmit,
  showReplyComposer,
}: {
  comment: TeamVideoCommentWithAnnotation
  replies: TeamVideoCommentWithAnnotation[]
  canWrite: boolean
  confirmingId: string | null
  /** True iff the parent supplied an onReply handler. Drives whether to
   *  render the Reply button at all. */
  canReply: boolean
  currentVersionNumber: number | null
  onJumpTo?: (t: number) => void
  onJumpToVersion?: (input: { versionNumber: number; timecodeSeconds: number }) => void
  onResolve?: (id: string) => void
  onDeleteClick?: (e: React.MouseEvent, id: string) => void
  onReplyOpen: () => void
  onReplyCancel: () => void
  onReplySubmit: (text: string) => Promise<void>
  showReplyComposer: boolean
}) {
  const annotation = c.annotation ? summariseDrawing(c.annotation.paths) : null
  const ToolIcon = annotation ? TOOL_ICON[annotation.tool] : null
  const hasTime = c.timecode_seconds != null
  const isOtherVersion =
    currentVersionNumber != null &&
    c.version_number != null &&
    c.version_number !== currentVersionNumber

  function handleClick() {
    if (!hasTime) return
    if (isOtherVersion && c.version_number != null && onJumpToVersion) {
      onJumpToVersion({
        versionNumber: c.version_number,
        timecodeSeconds: c.timecode_seconds!,
      })
      return
    }
    onJumpTo?.(c.timecode_seconds!)
  }

  return (
    <li
      className={`rounded-md border bg-card transition-colors ${
        hasTime ? "cursor-pointer hover:bg-muted/40" : ""
      } ${isOtherVersion ? "opacity-75" : ""}`}
      onClick={handleClick}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <CommentHeader comment={c} annotation={annotation} ToolIcon={ToolIcon} hasTime={hasTime} />
            <p className="text-sm">{c.comment_text}</p>
          </div>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  onResolve?.(c.id)
                }}
                aria-label="Resolve comment"
                title="Resolve"
              >
                <CheckCircle2 className="size-4" />
              </Button>
              {onDeleteClick && (
                <Button
                  type="button"
                  size="sm"
                  variant={confirmingId === c.id ? "destructive" : "ghost"}
                  onClick={(e) => onDeleteClick(e, c.id)}
                  aria-label={confirmingId === c.id ? "Confirm delete" : "Delete"}
                  title={confirmingId === c.id ? "Click again to confirm" : "Delete"}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Replies — indented under the parent */}
      {replies.length > 0 && (
        <ul className="border-t border-border bg-muted/20 pl-2">
          {replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </ul>
      )}

      {/* Reply composer + button */}
      {canReply && (
        <div className="border-t border-border p-2">
          {showReplyComposer ? (
            <ReplyComposer onCancel={onReplyCancel} onSubmit={onReplySubmit} />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onReplyOpen()
              }}
              className="flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              <CornerDownRight className="size-3.5" strokeWidth={1.5} />
              Reply
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function ResolvedRow({
  comment: c,
  replies,
  canWrite,
  confirmingId,
  onReopen,
  onDeleteClick,
}: {
  comment: TeamVideoCommentWithAnnotation
  replies: TeamVideoCommentWithAnnotation[]
  canWrite: boolean
  confirmingId: string | null
  onReopen?: (id: string) => void
  onDeleteClick?: (e: React.MouseEvent, id: string) => void
}) {
  return (
    <li className="rounded-md border bg-muted/40 opacity-70">
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground line-through">
                {fmtTime(c.timecode_seconds)}
              </span>
              {c.author && <AuthorBadge author={c.author} muted />}
            </div>
            <p className="text-sm line-through">{c.comment_text}</p>
          </div>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onReopen?.(c.id)}
                aria-label="Reopen"
                title="Reopen"
              >
                <RotateCw className="size-4" />
              </Button>
              {onDeleteClick && (
                <Button
                  type="button"
                  size="sm"
                  variant={confirmingId === c.id ? "destructive" : "ghost"}
                  onClick={(e) => onDeleteClick(e, c.id)}
                  aria-label={confirmingId === c.id ? "Confirm delete" : "Delete"}
                  title={confirmingId === c.id ? "Click again to confirm" : "Delete"}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {replies.length > 0 && (
        <ul className="border-t border-border bg-muted/30 pl-2">
          {replies.map((r) => (
            <ReplyRow key={r.id} reply={r} />
          ))}
        </ul>
      )}
    </li>
  )
}

function ReplyRow({ reply }: { reply: TeamVideoCommentWithAnnotation }) {
  return (
    <li className="border-l-2 border-accent/40 pl-3 py-2 pr-2">
      <div className="space-y-1">
        {reply.author && (
          <div className="flex items-center gap-2">
            <CornerDownRight className="size-3 text-muted-foreground" strokeWidth={1.5} />
            <AuthorBadge author={reply.author} />
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {fmtRelative(reply.created_at)}
            </span>
          </div>
        )}
        <p className="pl-5 text-sm">{reply.comment_text}</p>
      </div>
    </li>
  )
}

function CommentHeader({
  comment: c,
  annotation,
  ToolIcon,
  hasTime,
}: {
  comment: TeamVideoCommentWithAnnotation
  annotation: ReturnType<typeof summariseDrawing>
  ToolIcon: (typeof TOOL_ICON)[keyof typeof TOOL_ICON] | null
  hasTime: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`font-mono text-xs font-medium ${
          hasTime ? "text-primary group-hover:underline" : "text-muted-foreground"
        }`}
      >
        {fmtTime(c.timecode_seconds)}
      </span>
      {c.version_number != null && (
        <span
          className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums tracking-wide text-primary"
          title={`Posted on version ${c.version_number}`}
        >
          v{c.version_number}
        </span>
      )}
      {c.author && <AuthorBadge author={c.author} />}
      {annotation && ToolIcon && (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          title={`${annotation.count} ${annotation.tool}${annotation.count === 1 ? "" : "s"} on the frame — click to jump`}
        >
          <ToolIcon className="size-3" style={{ color: annotation.color }} />
          <span>{annotation.count}</span>
        </span>
      )}
    </div>
  )
}

function AuthorBadge({
  author,
  muted,
}: {
  author: NonNullable<TeamVideoCommentWithAnnotation["author"]>
  muted?: boolean
}) {
  const initials = author.name
    .split(" ")
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("")
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${muted ? "opacity-60" : ""}`}
      title={`${author.name} · ${author.role}`}
    >
      <span
        aria-hidden
        className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-primary"
      >
        {initials || "?"}
      </span>
      <span className="text-xs font-medium text-primary truncate max-w-[120px]">
        {author.name}
      </span>
      <span
        className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase ${
          ROLE_PILL[author.role] ?? "bg-muted text-muted-foreground"
        }`}
      >
        {author.role}
      </span>
    </span>
  )
}

function ReplyComposer({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (text: string) => Promise<void>
}) {
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function send() {
    if (!text.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(text.trim())
      setText("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reply")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Reply to this comment…"
        disabled={submitting}
        className="text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
          if (e.key === "Escape") onCancel()
        }}
      />
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground">
          ⌘↵ to send · esc to cancel
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={send} disabled={submitting || !text.trim()}>
            <Send className="mr-1 size-3.5" />
            {submitting ? "Sending…" : "Reply"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
