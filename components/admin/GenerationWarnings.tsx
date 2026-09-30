import { AlertTriangle, Sparkles } from "lucide-react"

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

/**
 * How the coach's instructions were read for a week/day generation: Opus 5.5
 * rewrites them into counts and areas before the planning agents run
 * (functions/src/ai/instruction-enrich.ts). Shown so a misreading is visible —
 * the 2026-09-30 one-exercise Monday was a silent misreading.
 */
export interface InstructionsUsed {
  original: string
  enriched: string | null
  model: string | null
  note: string | null
}

/** Defensive read of `result.instructions_used` — older deployments never wrote it. */
export function extractInstructionsUsed(result: unknown): InstructionsUsed | null {
  const raw = (result as { instructions_used?: unknown } | null)?.instructions_used
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  if (typeof r.original !== "string") return null
  return { original: r.original, enriched: str(r.enriched), model: str(r.model), note: str(r.note) }
}

export function InstructionsUsedPanel({
  used,
  defaultOpen = false,
}: {
  used: InstructionsUsed | null
  defaultOpen?: boolean
}) {
  if (!used) return null
  const text = used.enriched ?? used.original

  return (
    <details open={defaultOpen} className="w-full rounded-lg border border-border bg-surface/50 p-3 text-left">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
        <Sparkles className="size-3.5 shrink-0 text-accent" />
        How the AI read your instructions
      </summary>
      {used.note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{used.note}</p> : null}
      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{text}</p>
    </details>
  )
}
