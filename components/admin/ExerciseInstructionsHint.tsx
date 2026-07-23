import { ListChecks } from "lucide-react"

/**
 * Read-only preview of the exercise's library instructions, shown while the
 * coach writes per-program notes. The client sees both in the same Instructions
 * dropdown (WorkoutDay), so this prevents duplicating cues that already exist.
 */
export function ExerciseInstructionsHint({ instructions }: { instructions: string | null | undefined }) {
  if (!instructions?.trim()) return null

  return (
    <div className="rounded-lg border border-border bg-surface/30 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <ListChecks className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-muted-foreground">
          Exercise instructions — the client already sees these
        </span>
      </div>
      <p className="max-h-28 overflow-y-auto text-xs leading-relaxed text-foreground/80 whitespace-pre-line">
        {instructions}
      </p>
    </div>
  )
}
