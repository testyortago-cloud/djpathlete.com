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

export type PackReminderAction = "warn_auto_renew" | "remind_manually"

export interface ClassifiedPackReminder extends PackReminder {
  action: PackReminderAction
}

/**
 * Pure: given packs already selected by selectPacksNeedingReminder (so the
 * last_reminded_threshold escalation semantics above are already applied —
 * this does not invent a second "already nudged" mechanism), decide which of
 * two emails each one gets, or none:
 *
 * - Armed (`auto_renew`) at `low`, payer has a card on file -> the NEW
 *   auto-renew WARNING. A real charge is coming, so we name it.
 * - Armed at `low`, no card -> the ORDINARY "get in touch" reminder. No card
 *   means no charge is coming — warning about one would be a lie.
 * - Armed at `empty` -> NEITHER. Something else (the inline check-in trigger
 *   or the cron sweep) is already resolving this pack's fate — a receipt, a
 *   decline notice, or a no-card payment link — and a third, contradictory
 *   "sessions ran out, get in touch" email minutes later is worse than
 *   silence.
 * - Everything else (unarmed at any threshold, armed at `expiring`) keeps
 *   today's single reminder email, unchanged.
 *
 * `hasCard` is a synchronous, caller-supplied lookup — card presence is an
 * INPUT here, never something this function fetches itself, so it stays
 * testable with zero mocks. It is only ever consulted for an armed pack at
 * `low` (short-circuited everywhere else), which also means it is safe for a
 * caller to make it expensive (e.g. backed by an already-resolved Map) without
 * this function triggering unnecessary lookups.
 */
export function classifyPackReminders(
  reminders: PackReminder[],
  hasCard: (pkg: ClientPackage) => boolean,
): ClassifiedPackReminder[] {
  const out: ClassifiedPackReminder[] = []
  for (const reminder of reminders) {
    const { pkg, threshold } = reminder
    if (threshold === "empty" && pkg.auto_renew) continue // suppressed
    const action: PackReminderAction =
      threshold === "low" && pkg.auto_renew && hasCard(pkg) ? "warn_auto_renew" : "remind_manually"
    out.push({ ...reminder, action })
  }
  return out
}
