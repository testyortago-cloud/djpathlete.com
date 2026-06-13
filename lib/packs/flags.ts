import { getSetting } from "@/lib/db/system-settings"

// Session Packs is always available (no feature gate). The only DB-backed toggle
// is the daily renewal-reminder cron (opt-in, since it emails clients).
export const PACK_RENEWALS_CRON_KEY = "cron_pack_renewals_enabled"

// Tunable thresholds.
export const PACK_REMINDER_LOW_KEY = "pack_reminder_low_at"
export const PACK_REMINDER_EXPIRY_KEY = "pack_reminder_expiry_days"

export const PACK_REMINDER_LOW_DEFAULT = 2
export const PACK_REMINDER_EXPIRY_DEFAULT = 7

export const packReminderLowAt = () => getSetting<number>(PACK_REMINDER_LOW_KEY, PACK_REMINDER_LOW_DEFAULT)
export const packReminderExpiryDays = () => getSetting<number>(PACK_REMINDER_EXPIRY_KEY, PACK_REMINDER_EXPIRY_DEFAULT)
