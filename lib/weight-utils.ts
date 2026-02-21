import type { WeightUnit } from "@/types/database"

const KG_TO_LBS = 2.20462

/** Convert kg value to the display unit. Returns null if input is null. */
export function displayWeight(kg: number | null, unit: WeightUnit): number | null {
  if (kg == null) return null
  if (unit === "kg") return kg
  return Math.round(kg * KG_TO_LBS * 10) / 10
}

/** Format weight with unit label, e.g. "80 kg" or "176.4 lbs". Returns "--" for null. */
export function formatWeight(kg: number | null, unit: WeightUnit): string {
  const val = displayWeight(kg, unit)
  if (val == null) return "--"
  return `${val} ${unit}`
}

/** Compact format without space, e.g. "80kg" or "176.4lbs". Returns "--" for null. */
export function formatWeightCompact(kg: number | null, unit: WeightUnit): string {
  const val = displayWeight(kg, unit)
  if (val == null) return "--"
  return `${val}${unit}`
}

/** Convert a user-entered value back to kg for storage. */
export function toKg(value: number, unit: WeightUnit): number {
  if (unit === "kg") return value
  return Math.round((value / KG_TO_LBS) * 10) / 10
}

/** Returns the unit label string ("kg" or "lbs"). */
export function unitLabel(unit: WeightUnit): string {
  return unit
}
