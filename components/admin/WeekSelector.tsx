"use client"

import { Copy, ClipboardCopy, Plus, Sparkles, Trash2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface WeekSelectorProps {
  totalWeeks: number
  selectedWeek: number
  onSelectWeek: (week: number) => void
  onDuplicateWeek: () => void
  onCopyFromProgram: () => void
  onAddWeek: () => void
  isAddingWeek?: boolean
  onDeleteWeek: () => void
  isDeletingWeek?: boolean
  onGenerateWeek?: () => void
  canGenerateWeek?: boolean
  /** Set of week numbers that have no exercises */
  blankWeeks?: Set<number>
  /** For each blank week, the week whose workout the client actually sees there (the "repeats" source). */
  repeatSourceByWeek?: Record<number, number>
}

export function WeekSelector({
  totalWeeks,
  selectedWeek,
  onSelectWeek,
  onDuplicateWeek,
  onCopyFromProgram,
  onAddWeek,
  isAddingWeek = false,
  onDeleteWeek,
  isDeletingWeek = false,
  onGenerateWeek,
  canGenerateWeek = false,
  blankWeeks = new Set(),
  repeatSourceByWeek = {},
}: WeekSelectorProps) {
  const selectedIsBlank = blankWeeks.has(selectedWeek)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
        const isBlank = blankWeeks.has(week)
        const repeatSrc = repeatSourceByWeek[week]
        return (
          <Button
            key={week}
            variant={week === selectedWeek ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectWeek(week)}
            className={
              isBlank && week !== selectedWeek ? "border-dashed border-muted-foreground/40 text-muted-foreground" : ""
            }
            title={
              isBlank
                ? repeatSrc
                  ? `Week ${week} is empty — client sees Week ${repeatSrc} repeated here`
                  : `Week ${week} (blank)`
                : `Week ${week}`
            }
          >
            Week {week}
            {isBlank &&
              (repeatSrc ? (
                <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] opacity-70">
                  <RefreshCw className="size-2.5" />W{repeatSrc}
                </span>
              ) : (
                <span className="ml-1 text-[10px] opacity-60">(blank)</span>
              ))}
          </Button>
        )
      })}
      <Button variant="outline" size="sm" onClick={onAddWeek} disabled={isAddingWeek} title="Add a new blank week">
        <Plus className="size-3.5" />
        {isAddingWeek ? "Adding..." : "Add Week"}
      </Button>
      <Button variant="outline" size="sm" onClick={onDuplicateWeek} title="Duplicate this week">
        <Copy className="size-3.5" />
        Duplicate Week
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onCopyFromProgram}
        title="Copy a day, week, or whole program from another client"
      >
        <ClipboardCopy className="size-3.5" />
        Copy from…
      </Button>
      {totalWeeks > 1 && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDeleteWeek}
          disabled={isDeletingWeek}
          title="Remove this week and all its exercises"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <Trash2 className="size-3.5" />
          {isDeletingWeek ? "Removing..." : "Remove Week"}
        </Button>
      )}
      {canGenerateWeek && onGenerateWeek && (
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerateWeek}
          title={
            selectedIsBlank
              ? `AI fill blank Week ${selectedWeek} using prior week logs`
              : "AI generate the next week based on client performance"
          }
          className="text-accent border-accent/30 hover:bg-accent/10"
        >
          <Sparkles className="size-3.5" />
          {selectedIsBlank ? `AI Fill Week ${selectedWeek}` : "AI Generate Week"}
        </Button>
      )}
    </div>
  )
}
