import type { ClientPackage, PackReminderThreshold } from "@/types/database"
import { reminderThreshold } from "@/lib/services/session-credits"

export interface PackReminder {
  pkg: ClientPackage
  threshold: PackReminderThreshold
}

// Severity ordering — a higher number means we've already nudged at/above this level.
const ORDER: Record<PackReminderThreshold, number> = { empty: 3, expiring: 2, low: 1 }

/**
 * Pure: select active packs that have reached a NEW (more severe than last-sent)
 * reminder threshold. A pack already nudged at `empty` won't be re-selected for
 * `low`, but a `low` pack that escalates to `empty` will be re-selected.
 */
export function selectPacksNeedingReminder(
  pkgs: ClientPackage[],
  now: Date,
  lowAt: number,
  expiryDays: number,
): PackReminder[] {
  const out: PackReminder[] = []
  for (const pkg of pkgs) {
    const th = reminderThreshold(pkg, now, lowAt, expiryDays)
    if (!th) continue
    const last = pkg.last_reminded_threshold
    if (last && ORDER[last] >= ORDER[th]) continue
    out.push({ pkg, threshold: th })
  }
  return out
}
