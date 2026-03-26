"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
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

const STORAGE_KEY = "djp-admin-weight-unit"

interface AdminWeightUnitContextValue {
  unit: WeightUnit
  setUnit: (unit: WeightUnit) => void
  displayWeight: (kg: number | null) => number | null
  formatWeight: (kg: number | null) => string
  formatWeightCompact: (kg: number | null) => string
  toKg: (value: number) => number
  unitLabel: () => string
}

const AdminWeightUnitContext = createContext<AdminWeightUnitContextValue | null>(null)

export function AdminWeightUnitProvider({
  children,
}: {
  children: ReactNode
}) {
  const [unit, setUnitState] = useState<WeightUnit>("lbs")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "kg" || stored === "lbs") {
      setUnitState(stored)
    }
  }, [])

  const setUnit = useCallback((newUnit: WeightUnit) => {
    setUnitState(newUnit)
    localStorage.setItem(STORAGE_KEY, newUnit)
  }, [])

  const value: AdminWeightUnitContextValue = {
    unit,
    setUnit,
    displayWeight: (kg) => _displayWeight(kg, unit),
    formatWeight: (kg) => _formatWeight(kg, unit),
    formatWeightCompact: (kg) => _formatWeightCompact(kg, unit),
    toKg: (v) => _toKg(v, unit),
    unitLabel: () => _unitLabel(unit),
  }

  return (
    <AdminWeightUnitContext.Provider value={value}>
      {children}
    </AdminWeightUnitContext.Provider>
  )
}

export function useAdminWeightUnit(): AdminWeightUnitContextValue {
  const ctx = useContext(AdminWeightUnitContext)
  if (!ctx) {
    throw new Error("useAdminWeightUnit must be used within an AdminWeightUnitProvider")
  }
  return ctx
}
