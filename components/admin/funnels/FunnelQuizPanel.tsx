// components/admin/funnels/FunnelQuizPanel.tsx -- the quiz this funnel uses.
//
// A quiz is a database entity the page's `quiz` block points at BY ID, which
// is what lets one weight edit take effect on every page showing it with no
// re-publish. The cost of that indirection was that the quiz had no home: it
// lived on its own top-level sidebar screen, and nothing on the funnel that
// uses it said it existed. This panel is the way back -- you reach the quiz
// from the thing it belongs to.
//
// The editor keeps its own URL. Two funnels can point at one quiz, so nesting
// the editor under a single funnel's id would be a lie about ownership.
//
// House table throughout -- never a hand-rolled <table>. See CLAUDE.md.

import Link from "next/link"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
  type DataTableBadgeTone,
} from "@/components/ui/data-table"
import type { QuizListRow } from "@/lib/db/quizzes"

export interface FunnelQuizPanelItem {
  quizId: string
  /** The step whose page shows it -- the first, if more than one does. */
  stepName: string
  /** `null` when the block points at an id no `quizzes` row has any more. */
  quiz: QuizListRow | null
  attempts: { total: number; completed: number }
}

const STATUS_TONE: Record<string, DataTableBadgeTone> = {
  active: "success",
  draft: "warning",
  archived: "neutral",
}

export function FunnelQuizPanel({ items }: { items: FunnelQuizPanelItem[] }) {
  // NOTHING, not an empty card. Most funnels have no quiz, and an empty
  // "Quiz" card on every one of them is furniture that teaches the eye to
  // skip the place the real answer appears.
  if (items.length === 0) return null

  return (
    <div className="mb-6">
      <DataTableCard>
        <DataTableToolbar>
          <p className="text-sm text-muted-foreground">
            {items.length === 1 ? "This funnel uses a quiz." : `This funnel uses ${items.length} quizzes.`} Editing it
            changes every page that shows it, straight away -- there is nothing to re-publish.
          </p>
        </DataTableToolbar>

        <DataTable>
          <DataTableHeader>
            <DataTableHead>Quiz</DataTableHead>
            <DataTableHead>On</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Completed</DataTableHead>
            <DataTableHead>Started</DataTableHead>
          </DataTableHeader>
          <tbody>
            {items.map((entry) => (
              <DataTableRow key={entry.quizId}>
                <DataTableCell>
                  {entry.quiz ? (
                    <>
                      <Link
                        href={`/admin/funnels/quizzes/${entry.quizId}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {entry.quiz.name}
                      </Link>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{entry.quiz.key}</span>
                      {/* Same warning the quizzes list carries, for the same
                          reason: a seeded quiz's weights and cutoffs were
                          rebuilt from field metadata, not recovered. */}
                      {entry.quiz.seedMarker ? (
                        <DataTableBadge tone="warning" className="mt-1.5">
                          Unverified scoring
                        </DataTableBadge>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">This quiz no longer exists</span>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{entry.quizId}</span>
                    </>
                  )}
                </DataTableCell>
                <DataTableCell muted>{entry.stepName}</DataTableCell>
                <DataTableCell>
                  {entry.quiz ? (
                    <DataTableBadge tone={STATUS_TONE[entry.quiz.status] ?? "neutral"}>
                      {entry.quiz.status}
                    </DataTableBadge>
                  ) : (
                    <DataTableBadge tone="danger">missing</DataTableBadge>
                  )}
                </DataTableCell>
                <DataTableCell>{entry.attempts.completed}</DataTableCell>
                <DataTableCell>{entry.attempts.total}</DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
