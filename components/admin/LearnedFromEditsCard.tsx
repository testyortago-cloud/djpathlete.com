import { GraduationCap, ArrowDown, ArrowUp } from "lucide-react"
import {
  DataTableCard,
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableBadge,
} from "@/components/ui/data-table"
import { EDIT_LEARNING_DAYS, type ExerciseEditCount, type ExerciseEditSummary } from "@/lib/db/program-exercise-edits"

// The program builder's names for day_of_week 1..7.
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function CountList({ title, items, tone }: { title: string; items: ExerciseEditCount[]; tone: "down" | "up" }) {
  const Icon = tone === "down" ? ArrowDown : ArrowUp
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.exercise_id} className="flex items-center gap-2 text-sm">
              <Icon className={`size-3.5 shrink-0 ${tone === "down" ? "text-destructive" : "text-success"}`} />
              <span className="truncate text-foreground">{item.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {item.count} {item.count === 1 ? "time" : "times"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The exercise change log and what the generator learned from it (functions/src/ai/edit-learning.ts reads the
 * same rows and window).
 */
export function LearnedFromEditsCard({ summary }: { summary: ExerciseEditSummary }) {
  return (
    <DataTableCard>
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-4 text-primary" />
          <h2 className="text-sm font-medium text-primary">Learned from your edits</h2>
          <span className="text-xs text-muted-foreground">(last {EDIT_LEARNING_DAYS} days)</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          Every time you take out an exercise the AI picked, or put a new one into an AI program, it is recorded here.
          When the AI builds your next program, it ranks the exercises you keep taking out lower and the ones you keep
          putting in higher. To rule an exercise out completely, block it instead.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="rounded-lg bg-surface/50 p-3">
          <p className="text-xs text-muted-foreground">AI picks you took out</p>
          <p className="text-2xl font-semibold text-primary">{summary.removed}</p>
        </div>
        <div className="rounded-lg bg-surface/50 p-3">
          <p className="text-xs text-muted-foreground">Exercises you put in</p>
          <p className="text-2xl font-semibold text-primary">{summary.added}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 p-4">
        <CountList title="You often take out (ranked lower)" items={summary.topRemoved} tone="down" />
        <CountList title="You often put in (ranked higher)" items={summary.topAdded} tone="up" />
      </div>

      <DataTable>
        <DataTableHeader>
          <DataTableHead>Date</DataTableHead>
          <DataTableHead>Change</DataTableHead>
          <DataTableHead>Exercise</DataTableHead>
          <DataTableHead>Program</DataTableHead>
          <DataTableHead>Where</DataTableHead>
        </DataTableHeader>
        <tbody>
          {summary.recent.length === 0 ? (
            <DataTableEmpty colSpan={5}>
              No changes yet. Take an exercise out of an AI program, or add one, and it shows here.
            </DataTableEmpty>
          ) : (
            summary.recent.map((row, i) => (
              <DataTableRow key={`${row.created_at}-${i}`}>
                <DataTableCell muted>{formatDate(row.created_at)}</DataTableCell>
                <DataTableCell>
                  {row.action === "removed" ? (
                    <DataTableBadge tone="danger">Took out</DataTableBadge>
                  ) : (
                    <DataTableBadge tone="success">Put in</DataTableBadge>
                  )}
                </DataTableCell>
                <DataTableCell className="font-medium">{row.exercise}</DataTableCell>
                <DataTableCell muted>{row.program ?? "Deleted program"}</DataTableCell>
                <DataTableCell muted>
                  {row.week_number ? `Week ${row.week_number}` : "—"}
                  {row.day_of_week ? ` · ${DAY_NAMES[row.day_of_week - 1] ?? `Day ${row.day_of_week}`}` : ""}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
