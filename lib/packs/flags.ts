import { getSetting } from "@/lib/db/system-settings"

// Feature flags (DB-backed, admin-togglable; default OFF until the feature ships).
export const PACKS_ENABLED_KEY = "feature_session_packs_enabled"
export const QR_CHECKIN_ENABLED_KEY = "feature_qr_checkin_enabled"
export const PACK_RENEWALS_CRON_KEY = "cron_pack_renewals_enabled"

// Tunable thresholds.
export const PACK_REMINDER_LOW_KEY = "pack_reminder_low_at"
export const PACK_REMINDER_EXPIRY_KEY = "pack_reminder_expiry_days"

export const PACK_REMINDER_LOW_DEFAULT = 2
export const PACK_REMINDER_EXPIRY_DEFAULT = 7

export const packsEnabled = () => getSetting<boolean>(PACKS_ENABLED_KEY, false)
export const qrCheckinEnabled = () => getSetting<boolean>(QR_CHECKIN_ENABLED_KEY, false)
export const packReminderLowAt = () => getSetting<number>(PACK_REMINDER_LOW_KEY, PACK_REMINDER_LOW_DEFAULT)
export const packReminderExpiryDays = () => getSetting<number>(PACK_REMINDER_EXPIRY_KEY, PACK_REMINDER_EXPIRY_DEFAULT)
