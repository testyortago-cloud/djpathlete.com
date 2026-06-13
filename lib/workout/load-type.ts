import type { LoadType } from "@/types/database"

export const LOAD_TYPES: LoadType[] = ["total", "per_dumbbell", "per_side"]

/** Admin-facing labels for the exercise editor. */
export const LOAD_TYPE_ADMIN_LABELS: Record<LoadType, string> = {
  total: "Total weight (one number)",
  per_dumbbell: "Per dumbbell (client holds two)",
  per_side: "Per side (one limb at a time)",
}

/**
 * Metadata for a load type:
 * - `multiplier`: how many times the entered weight is actually moved per rep,
 *   used for volume-load math (one dumbbell entered → ×2 actually lifted).
 * - `clientLabel`: short hint shown next to the weight box so the client knows
 *   what number to enter; `null` means no hint needed.
 */
export function loadTypeMeta(loadType: LoadType | null | undefined): {
  multiplier: number
  clientLabel: string | null
} {
  switch (loadType) {
    case "per_dumbbell":
      return { multiplier: 2, clientLabel: "per dumbbell — enter one" }
    case "per_side":
      return { multiplier: 2, clientLabel: "per side" }
    case "total":
    default:
      return { multiplier: 1, clientLabel: null }
  }
}
