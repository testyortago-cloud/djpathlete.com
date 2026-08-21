// lib/content-schedule/flag.ts
// Leaf module on purpose — imported by routes, the runner, and the catalogue
// test, so it must stay dependency-free. Mirrors lib/funnels/checkout/flag.ts.

/** system_settings key gating the scheduled-content checker. */
export const CONTENT_SCHEDULE_FLAG = "cron_content_schedule_enabled"

/**
 * Value when no settings row exists. TRUE, unlike most new cron flags: a
 * scheduler whose checker is off is not a dormant feature, it is a UI that
 * accepts a time and silently does nothing. The /schedule routes refuse while
 * this is false, so "accepts schedules, never fires them" cannot occur.
 */
export const CONTENT_SCHEDULE_DEFAULT = true
