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

// ── Client-facing pack feature flags (DB-backed, admin-togglable, default OFF) ──
export const CLIENT_PACK_BALANCE_KEY = "client_pack_balance_enabled"
export const CLIENT_SELF_CHECKIN_KEY = "client_self_checkin_enabled"
export const CLIENT_SELF_PURCHASE_KEY = "client_self_purchase_enabled"
// Stable per-client "personal" check-in link (no daily QR, no roster, no login).
export const CLIENT_PERSONAL_CHECKIN_KEY = "client_personal_checkin_enabled"

export const clientPackBalanceEnabled = () => getSetting<boolean>(CLIENT_PACK_BALANCE_KEY, false)
export const clientSelfCheckinEnabled = () => getSetting<boolean>(CLIENT_SELF_CHECKIN_KEY, false)
export const clientSelfPurchaseEnabled = () => getSetting<boolean>(CLIENT_SELF_PURCHASE_KEY, false)
export const clientPersonalCheckinEnabled = () => getSetting<boolean>(CLIENT_PERSONAL_CHECKIN_KEY, false)

// ── Recurring in-person sessions + billing (all DB-backed, default OFF) ────────
export const RECURRING_SESSIONS_KEY = "recurring_sessions_enabled"
export const CARD_ON_FILE_KEY = "card_on_file_enabled"
export const SESSION_MEMBERSHIPS_KEY = "session_memberships_enabled"
export const SESSION_FEES_KEY = "session_fees_enabled"

export const recurringSessionsEnabled = () => getSetting<boolean>(RECURRING_SESSIONS_KEY, false)
export const cardOnFileEnabled = () => getSetting<boolean>(CARD_ON_FILE_KEY, false)
export const sessionMembershipsEnabled = () => getSetting<boolean>(SESSION_MEMBERSHIPS_KEY, false)
export const sessionFeesEnabled = () => getSetting<boolean>(SESSION_FEES_KEY, false)

// Courtesy email to a household payer when their card covers someone else's
// fee. Default ON (kill-switch convention) — it only ever fires after a real
// successful charge, which is already behind the fee flag + amount + card gates.
export const SESSION_FEE_PAYER_NOTIFY_KEY = "session_fee_payer_notify_enabled"
export const sessionFeePayerNotifyEnabled = () => getSetting<boolean>(SESSION_FEE_PAYER_NOTIFY_KEY, true)

// Fee policy — admin-configurable, all default to a no-op (0 / a safe window).
export const NO_SHOW_FEE_CENTS_KEY = "no_show_fee_cents"
export const LATE_CANCEL_FEE_CENTS_KEY = "late_cancel_fee_cents"
export const CANCEL_WINDOW_HOURS_KEY = "cancel_window_hours"

export const noShowFeeCents = () => getSetting<number>(NO_SHOW_FEE_CENTS_KEY, 0)
export const lateCancelFeeCents = () => getSetting<number>(LATE_CANCEL_FEE_CENTS_KEY, 0)
export const cancelWindowHours = () => getSetting<number>(CANCEL_WINDOW_HOURS_KEY, 12)

// ── Pack auto-renew (DB-backed, default OFF — it moves real money) ────────────
export const PACK_AUTO_RENEW_KEY = "pack_auto_renew_enabled"
export const packAutoRenewEnabled = () => getSetting<boolean>(PACK_AUTO_RENEW_KEY, false)
