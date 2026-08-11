import { AlertTriangle } from "lucide-react"

/**
 * Coach-facing notices from an AI generation — pool attrition, slots that had to
 * repeat an exercise, notes stripped for narrating pipeline internals.
 *
 * These exist because a constrained generation used to be indistinguishable from
 * a clean one: the orchestrator logged its problems to a console nobody reads and
 * returned success either way, so a week full of duplicate exercises was only
 * discoverable by reading the finished week.
 *
 * Reads the array off the job result defensively — `result` is an untyped
 * passthrough from the function, and an older deployment returns no `warnings`
 * key at all.
 */
export function extractWarnings(result: unknown): string[] {
  const raw = (result as { warnings?: unknown } | null)?.warnings
  if (!Array.isArray(raw)) return []
  return raw.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
}

export function GenerationWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null

  return (
    <div className="w-full rounded-lg border border-warning/40 bg-warning/10 p-3 text-left">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
        <p className="text-xs font-medium text-foreground">
          {warnings.length === 1 ? "1 thing to check" : `${warnings.length} things to check`}
        </p>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {warnings.map((warning, i) => (
          <li key={i} className="text-xs leading-relaxed text-muted-foreground">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  )
}
