"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import type { WeightUnit } from "@/types/database"
import {
  displayWeight as _displayWeight,
  formatWeight as _formatWeight,
  formatWeightCompact as _formatWeightCompact,
  toKg as _toKg,
  unitLabel as _unitLabel,
} from "@/lib/weight-utils"

interface WeightUnitContextValue {
  unit: WeightUnit
  setUnit: (unit: WeightUnit) => void
  saving: boolean
  displayWeight: (kg: number | null) => number | null
  formatWeight: (kg: number | null) => string
  formatWeightCompact: (kg: number | null) => string
  toKg: (value: number) => number
  unitLabel: () => string
}

const WeightUnitContext = createContext<WeightUnitContextValue | null>(null)

export function WeightUnitProvider({
  initialUnit = "lbs",
  children,
}: {
  initialUnit?: WeightUnit
  children: ReactNode
}) {
  const [unit, setUnitState] = useState<WeightUnit>(initialUnit)
  const [saving, setSaving] = useState(false)

  const setUnit = useCallback(async (newUnit: WeightUnit) => {
    setUnitState(newUnit)
    setSaving(true)
    try {
      await fetch("/api/client/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight_unit: newUnit }),
      })
    } catch {
      // Silently fail — the local state is already updated
    } finally {
      setSaving(false)
    }
  }, [])

  const value: WeightUnitContextValue = {
    unit,
    setUnit,
    saving,
    displayWeight: (kg) => _displayWeight(kg, unit),
    formatWeight: (kg) => _formatWeight(kg, unit),
    formatWeightCompact: (kg) => _formatWeightCompact(kg, unit),
    toKg: (v) => _toKg(v, unit),
    unitLabel: () => _unitLabel(unit),
  }

  return (
    <WeightUnitContext.Provider value={value}>
      {children}
    </WeightUnitContext.Provider>
  )
}

export function useWeightUnit(): WeightUnitContextValue {
  const ctx = useContext(WeightUnitContext)
  if (!ctx) {
    throw new Error("useWeightUnit must be used within a WeightUnitProvider")
  }
  return ctx
}
