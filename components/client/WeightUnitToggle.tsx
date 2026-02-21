"use client"

import { useWeightUnit } from "@/hooks/use-weight-unit"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WeightUnit } from "@/types/database"

const options: { value: WeightUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "lbs", label: "lbs" },
]

export function WeightUnitToggle() {
  const { unit, setUnit, saving } = useWeightUnit()

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setUnit(opt.value)}
          disabled={saving}
          className={cn(
            "relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            unit === opt.value
              ? "bg-white text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
      {saving && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground ml-1" />
      )}
    </div>
  )
}
