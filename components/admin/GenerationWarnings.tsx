import { AlertTriangle, ListChecks, Sparkles } from "lucide-react"

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

/**
 * The result of checking the finished day/week against the coach's own
 * instructions (functions/src/ai/instruction-check.ts). Mirrors the shape the
 * function writes on `result.instruction_check`; the root app cannot import it.
 */
export interface InstructionCheckItem {
  instruction: string
  met: boolean
  detail: string
  source: "code" | "ai"
}

export interface InstructionCheck {
  status: "passed" | "failed" | "unchecked"
  items: InstructionCheckItem[]
  rebuilt: boolean
  rebuild_reason: string | null
  note: string | null
}

/** Defensive read of `result.instruction_check` — older deployments never wrote it. */
export function extractInstructionCheck(result: unknown): InstructionCheck | null {
  const raw = (result as { instruction_check?: unknown } | null)?.instruction_check
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.status !== "passed" && r.status !== "failed" && r.status !== "unchecked") return null
  if (!Array.isArray(r.items)) return null
  const items: InstructionCheckItem[] = []
  for (const it of r.items) {
    if (!it || typeof it !== "object") continue
    const i = it as Record<string, unknown>
    if (typeof i.instruction !== "string" || typeof i.detail !== "string" || typeof i.met !== "boolean") continue
    items.push({ instruction: i.instruction, met: i.met, detail: i.detail, source: i.source === "ai" ? "ai" : "code" })
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  return {
    status: r.status,
    items,
    rebuilt: r.rebuilt === true,
    rebuild_reason: str(r.rebuild_reason),
    note: str(r.note),
  }
}

/**
 * Whether InstructionCheckPanel would render anything — so a caller that wraps
 * the panel for spacing can skip the wrapper too, instead of leaving an empty gap.
 */
export function hasInstructionCheckContent(check: InstructionCheck | null): check is InstructionCheck {
  if (!check) return false
  return !(check.status === "unchecked" && check.items.length === 0 && !check.note)
}

export function InstructionCheckPanel({
  check,
  defaultOpen = false,
}: {
  check: InstructionCheck | null
  defaultOpen?: boolean
}) {
  if (!hasInstructionCheckContent(check)) return null
  const notMet = check.items.filter((i) => !i.met).length
  const showItems = check.status !== "unchecked"

  return (
    <details open={defaultOpen} className="w-full rounded-lg border border-border bg-surface/50 p-3 text-left">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground">
        <ListChecks className="size-3.5 shrink-0 text-accent" />
        <span>
          Your instructions, checked
          {notMet > 0 ? <span className="text-error">{` — ${notMet} not met`}</span> : null}
        </span>
      </summary>
      {showItems ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {check.items.map((item, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
              <span aria-hidden="true" className={item.met ? "text-success" : "text-error"}>
                {item.met ? "✓" : "✗"}
              </span>
              <span>
                <span className="sr-only">{item.met ? "Met:" : "Not met:"}</span>
                <span className="font-medium text-foreground">{item.instruction}</span>
                <span className="text-muted-foreground">{` — ${item.detail}`}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {showItems && check.rebuilt && check.rebuild_reason ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{`Rebuilt once to fix: ${check.rebuild_reason}`}</p>
      ) : null}
      {check.note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{check.note}</p> : null}
    </details>
  )
}
