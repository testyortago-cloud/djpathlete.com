import { FileSpreadsheet, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export function ImportReportCard({ params }: { params: Record<string, unknown> }) {
  if (params.source !== "excel_import") return null

  const counts = (params.counts as { days?: number; exercises?: number; weeks?: number }) ?? {}
  const matched = (params.matched as { raw_name: string; exercise_name: string; method: string }[]) ?? []
  const created = (params.created as { raw_name: string; exercise_id: string }[]) ?? []
  const gapsFilled = (params.gaps_filled as string[]) ?? []
  const assumptions = (params.assumptions as string[]) ?? []
  const notes = params.interpretation_notes as string | null | undefined
  const fileName = params.file_name as string | undefined

  const hasDetails = gapsFilled.length > 0 || assumptions.length > 0 || !!notes

  return (
    <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <FileSpreadsheet className="size-4 text-accent" />
        <h3 className="text-sm font-heading font-semibold text-foreground">Imported from Excel</h3>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {counts.weeks != null && (
          <Badge variant="outline">
            {counts.weeks} week{counts.weeks !== 1 ? "s" : ""}
          </Badge>
        )}
        {counts.days != null && (
          <Badge variant="outline">
            {counts.days} day{counts.days !== 1 ? "s" : ""}
          </Badge>
        )}
        {counts.exercises != null && (
          <Badge variant="outline">
            <span>{counts.exercises} exercises</span>
          </Badge>
        )}
        <Badge variant="outline">
          {matched.length} matched
        </Badge>
      </div>

      {created.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            New exercises added to your library — review these
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These exercises didn&apos;t match anything in your library, so the AI created new entries. Double-check
            their category and equipment before assigning this program.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-foreground">
            {created.map((item, idx) => (
              <li key={`${item.exercise_id}-${idx}`} className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-warning" />
                {item.raw_name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasDetails && (
        <details className="mt-3">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none">
            View import details
          </summary>
          <div className="mt-2 space-y-3">
            {gapsFilled.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground">Gaps filled</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {gapsFilled.map((gap, idx) => (
                    <li key={idx}>• {gap}</li>
                  ))}
                </ul>
              </div>
            )}
            {assumptions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground">Assumptions</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {assumptions.map((assumption, idx) => (
                    <li key={idx}>• {assumption}</li>
                  ))}
                </ul>
              </div>
            )}
            {notes && (
              <div>
                <p className="text-xs font-medium text-foreground">Interpretation notes</p>
                <p className="mt-1 text-xs text-muted-foreground">{notes}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
