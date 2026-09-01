"use client"

// components/admin/pipeline-board.tsx — the admin surface for the Lead
// Engine board. One column per pipeline stage (position order), cards
// draggable between them via @dnd-kit (pattern matches
// components/admin/content-studio/pipeline/{Lane,PostCard,PostsLane}.tsx —
// the established DnD board in this repo).
//
// Every drop calls POST /api/admin/pipeline/move, which delegates entirely
// to `moveOpportunityManually` (lib/db/pipeline.ts). This component does not
// decide what a move means — dropping into Won or Lost closes the deal,
// dropping a closed card onto an open stage reopens it, and both of those
// consequences are the DAL's job, not this file's.
//
// The board keeps its own optimistic copy of `columns` so a drag feels
// instant, and re-syncs from the server prop whenever it changes (a
// `router.refresh()` after a successful move, or a parent re-render) — same
// shape as PostsLane's `useEffect(() => setPosts(initialPosts), [initialPosts])`.
// A FAILED move rolls the optimistic copy back and surfaces the server's
// error message via toast rather than leaving the board showing a move that
// never actually happened.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { GrantProgramDialog } from "@/components/admin/GrantProgramDialog"
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { formatCents } from "@/lib/bookkeeping/money"
import type { BoardColumn, BoardCard } from "@/lib/db/pipeline"
import type { Staleness } from "@/lib/lead-engine/pipeline-move"

interface PipelineBoardProps {
  columns: BoardColumn[]
  /**
   * The programs a won deal can hand over — priced products only, never the
   * athletes' own named plans. See `listGrantablePrograms`.
   */
  grantablePrograms: Array<{ id: string; name: string; price_cents: number | null }>
}

// `stage.name` (the configured column, e.g. "Consult Booked") is the real
// label and is what renders. This is a DEFENSIVE FALLBACK ONLY, for a null
// or empty name (the DB column is NOT NULL, so that should never happen, but
// a fallback that silently reconstructs the wrong thing is worse than one
// that's honest about being a fallback) — never the primary source. Deriving
// display copy from `key` instead of `name` is exactly the bug this function
// used to be: it reproduces today's seed by coincidence, and silently keeps
// showing "Consult Booked" after a business renames the stage to "Discovery
// Call", because nothing about `key` changes when only `name` does.
function stageLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
}

const STALENESS_LABEL: Record<Staleness, string> = {
  fresh: "On track",
  amber: "Slowing down",
  red: "Stalled",
}

// Semantic tokens only (CLAUDE.md) — no hardcoded hex, ever.
const STALENESS_DOT: Record<Staleness, string> = {
  fresh: "bg-success",
  amber: "bg-warning",
  red: "bg-error",
}

const STAGE_RULE: Record<string, string> = {
  open: "bg-accent/70",
  won: "bg-success/80",
  lost: "bg-error/80",
}

function daysInStage(enteredStageAt: string): number {
  const ms = Date.now() - new Date(enteredStageAt).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function PipelineCard({ card, stageKind }: { card: BoardCard; stageKind: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id })
  const days = daysInStage(card.enteredStageAt)
  const label = card.contactName ?? "Unnamed contact"

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-white px-3 py-2.5 shadow-sm transition active:cursor-grabbing",
        "hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-primary" title={label}>
          {label}
        </p>
        {stageKind === "open" && (
          <span
            className={cn("mt-1 inline-block size-2 shrink-0 rounded-full", STALENESS_DOT[card.staleness])}
            role="img"
            aria-label={STALENESS_LABEL[card.staleness]}
            title={STALENESS_LABEL[card.staleness]}
          />
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {days === 0 ? "Entered today" : `${days} day${days === 1 ? "" : "s"} in stage`}
      </p>
      {stageKind === "won" && card.valueCents != null && (
        <p className="mt-1.5 font-mono text-[12px] font-medium tabular-nums text-success">
          {formatCents(card.valueCents)}
        </p>
      )}
    </div>
  )
}

function PipelineColumn({ stage, cards }: { stage: BoardColumn["stage"]; cards: BoardCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[220px] min-w-[240px] flex-1 basis-0 flex-col rounded-xl border border-border/60 bg-white/80",
        "shadow-sm transition",
        isOver && "bg-primary/[0.04] ring-2 ring-primary/50",
      )}
    >
      <div className={cn("h-[3px] rounded-t-xl", STAGE_RULE[stage.kind] ?? "bg-border")} aria-hidden />
      <header className="flex items-center justify-between gap-2 px-3.5 pb-2.5 pt-3">
        <p className="truncate font-heading text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          {stage.name || stageLabel(stage.key)}
        </p>
        <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] font-medium tabular-nums leading-none text-muted-foreground">
          {cards.length}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5">
        {cards.map((card) => (
          <PipelineCard key={card.id} card={card} stageKind={stage.kind} />
        ))}
        {cards.length === 0 && (
          <div className="py-6 text-center text-[11px] italic text-muted-foreground/50">empty</div>
        )}
      </div>
    </div>
  )
}

export function PipelineBoard({ columns: initialColumns, grantablePrograms }: PipelineBoardProps) {
  const [columns, setColumns] = useState(initialColumns)
  // The card a coach just dropped on Won, waiting on "which program?". Null
  // means no prompt is open. Winning a deal does NOT grant anything on its
  // own — see the dialog's own note.
  const [grantFor, setGrantFor] = useState<{ id: string; label: string } | null>(null)
  const router = useRouter()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Re-sync when the server sends fresh data (post-move router.refresh(), or
  // a parent re-render) — mirrors PostsLane's own effect for the same reason.
  useEffect(() => {
    setColumns(initialColumns)
  }, [initialColumns])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const toStageKey = String(over.id)

    const fromColumn = columns.find((col) => col.cards.some((c) => c.id === active.id))
    const card = fromColumn?.cards.find((c) => c.id === active.id)
    const toColumn = columns.find((col) => col.stage.key === toStageKey)
    if (!fromColumn || !card || !toColumn) return
    if (fromColumn.stage.id === toColumn.stage.id) return // dropped back on its own column

    const previous = columns
    setColumns((prev) =>
      prev.map((col) => {
        if (col.stage.id === fromColumn.stage.id) {
          return { ...col, cards: col.cards.filter((c) => c.id !== card.id) }
        }
        if (col.stage.id === toColumn.stage.id) {
          return { ...col, cards: [...col.cards, card] }
        }
        return col
      }),
    )

    try {
      const res = await fetch("/api/admin/pipeline/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: card.id, toStageKey }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Move failed")
      }
      toast.success(`Moved to ${toColumn.stage.name || stageLabel(toStageKey)}`)

      // WON IS A QUESTION, NOT AN INSTRUCTION. A won card can be a cash deal,
      // a camp, or a plan nobody has priced, so the prompt asks which program
      // was bought instead of guessing from the card's value. Nothing is
      // created until the coach answers — dismissing this leaves the deal won
      // and the athlete without an account, which is a perfectly normal
      // outcome and not an error.
      if (toColumn.stage.kind === "won") {
        setGrantFor({ id: card.id, label: card.contactName || "this athlete" })
      }

      router.refresh()
    } catch (err) {
      setColumns(previous)
      toast.error(err instanceof Error ? err.message : "Move failed")
    }
  }

  const orderedColumns = [...columns].sort((a, b) => a.stage.position - b.stage.position)

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {orderedColumns.map((col) => (
          <PipelineColumn key={col.stage.id} stage={col.stage} cards={col.cards} />
        ))}
      </div>
      <GrantProgramDialog
        target={grantFor}
        programs={grantablePrograms}
        onClose={() => setGrantFor(null)}
        onGranted={() => router.refresh()}
      />
    </DndContext>
  )
}
