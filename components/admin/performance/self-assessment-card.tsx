import { ClipboardCheck } from "lucide-react"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"
// Types only: the module reads the database, and this card renders inside a client component.
import type { ClientQuizResult } from "@/lib/quizzes/client-result"
import type { MapRow, MapStatus } from "@/lib/quizzes/report"

const STATUS: Record<MapStatus, { label: string; tone: "danger" | "warning" | "info" | "success" }> = {
  gap: { label: "Big side difference", tone: "danger" },
  leak: { label: "Low", tone: "warning" },
  watch: { label: "Room to improve", tone: "info" },
  solid: { label: "Solid", tone: "success" },
}

const TIER_TONE: Record<string, "danger" | "warning" | "success"> = {
  red: "danger",
  orange: "warning",
  yellow: "warning",
  green: "success",
}

function sides(row: MapRow): string {
  if (row.single !== null) return `${row.single}/${row.max}`
  return [
    row.left !== null ? `L ${row.left}/${row.max}` : null,
    row.right !== null ? `R ${row.right}/${row.max}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The client's own website quiz result: what AI Generate reads for their next program. */
export function SelfAssessmentCard({ result }: { result: ClientQuizResult | null }) {
  if (!result) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
        <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-primary">Self-assessment</span> — none yet. When this client fills in one
          of your website quizzes with the email on their account, the result shows here and AI Generate uses it.
        </p>
      </div>
    )
  }

  // Fixed locale and UTC: this renders on the server and again in the browser, and the two must match (and
  // match the date the AI is given).
  const taken = new Date(result.completedAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
  return (
    <DataTableCard>
      <DataTableToolbar className="sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck className="size-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold text-primary">Self-assessment</p>
          <p className="truncate text-sm text-muted-foreground">
            {result.quizName} · taken {taken}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {result.score !== null && <DataTableBadge tone="info">Score {result.score}/100</DataTableBadge>}
          {result.tier && (
            <DataTableBadge tone={TIER_TONE[result.tier] ?? "neutral"} className="capitalize">
              {result.tier}
            </DataTableBadge>
          )}
          {result.profile && <DataTableBadge>{result.profile}</DataTableBadge>}
          {result.branch && <DataTableBadge>{result.branch}</DataTableBadge>}
        </div>
      </DataTableToolbar>
      {result.map.length > 0 && (
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Area</DataTableHead>
            <DataTableHead>Their answer</DataTableHead>
            <DataTableHead>Status</DataTableHead>
          </DataTableHeader>
          <tbody>
            {result.map.map((row) => (
              <DataTableRow key={row.label}>
                <DataTableCell className="font-medium text-foreground">{row.label}</DataTableCell>
                <DataTableCell className="tabular-nums">{sides(row)}</DataTableCell>
                <DataTableCell>
                  <DataTableBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</DataTableBadge>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      )}
      {result.otherAnswers.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
          {result.otherAnswers.map((line) => (
            <div key={line.prompt} className="contents">
              <dt className="text-muted-foreground">{line.prompt}</dt>
              <dd className="text-foreground">{line.answer}</dd>
            </div>
          ))}
        </dl>
      )}
      <DataTableFooter className="text-muted-foreground">
        The client filled this in themselves. AI Generate uses it for their next program, after your instructions and
        their injuries.
      </DataTableFooter>
    </DataTableCard>
  )
}
