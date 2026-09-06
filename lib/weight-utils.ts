import type { WeightUnit } from "@/types/database"

const KG_TO_LBS = 2.20462

/**
 * Decimals kept when persisting a converted weight.
 *
 * Storage must stay MORE precise than the display, or the value the client
 * sees is not the value the coach typed. Rounding to 2dp here made 40 lbs
 * persist as 18.14 kg, which renders back as 39.99 lbs. Six decimals round-trip
 * every 0.5 lb and 1 lb input up to 1000 exactly, and `numeric` columns are
 * unbounded so there is no schema cost.
 */
const STORAGE_DECIMALS = 6

/** Decimals shown to a human. Presentation only — never applied to storage. */
const DISPLAY_DECIMALS = 2

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Convert kg value to the display unit. Returns null if input is null. */
export function displayWeight(kg: number | null, unit: WeightUnit): number | null {
  if (kg == null) return null
  // Both branches round: storage now carries more decimals than a human wants
  // to read, so the kg path can no longer pass the raw value straight through.
  if (unit === "kg") return roundTo(kg, DISPLAY_DECIMALS)
  return roundTo(kg * KG_TO_LBS, DISPLAY_DECIMALS)
}

/** Format weight with unit label, e.g. "80 kg" or "176.37 lbs". Returns "--" for null. */
export function formatWeight(kg: number | null, unit: WeightUnit): string {
  const val = displayWeight(kg, unit)
  if (val == null) return "--"
  return `${val} ${unit}`
}

/** Compact format without space, e.g. "80kg" or "176.37lbs". Returns "--" for null. */
export function formatWeightCompact(kg: number | null, unit: WeightUnit): string {
  const val = displayWeight(kg, unit)
  if (val == null) return "--"
  return `${val}${unit}`
}

/** Convert a user-entered value back to kg for storage. */
export function toKg(value: number, unit: WeightUnit): number {
  if (unit === "kg") return value
  return roundTo(value / KG_TO_LBS, STORAGE_DECIMALS)
}

/** Returns the unit label string ("kg" or "lbs"). */
export function unitLabel(unit: WeightUnit): string {
  return unit
}
