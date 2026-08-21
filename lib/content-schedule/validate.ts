// lib/content-schedule/validate.ts
// Shared request validation for the four schedule routes. Kept out of the
// route files so all four reject identically.

import { getSetting } from "@/lib/db/system-settings"
import { CONTENT_SCHEDULE_FLAG, CONTENT_SCHEDULE_DEFAULT } from "@/lib/content-schedule/flag"

export type ScheduleRejection = { status: 400 | 409; error: string }

export async function validateScheduleRequest(
  raw: unknown,
): Promise<{ ok: true; scheduledAt: Date } | ({ ok: false } & ScheduleRejection)> {
  // Refuse while the checker is off. Without this the UI would accept a time
  // that nothing will ever act on — the exact failure the flag default is
  // meant to prevent.
  const enabled = await getSetting<boolean>(CONTENT_SCHEDULE_FLAG, CONTENT_SCHEDULE_DEFAULT)
  if (!enabled) {
    return {
      ok: false,
      status: 409,
      error:
        "Scheduling is switched off right now, so this would never go out. Turn on “Scheduled posts and newsletters” on the Automation page first.",
    }
  }

  const value = (raw as { scheduled_at?: string } | null)?.scheduled_at?.trim()
  if (!value) {
    return { ok: false, status: 400, error: "Pick a date and time first." }
  }

  const scheduledAt = new Date(value)
  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, status: 400, error: "That date and time could not be read." }
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return { ok: false, status: 400, error: "Pick a time in the future." }
  }

  return { ok: true, scheduledAt }
}
