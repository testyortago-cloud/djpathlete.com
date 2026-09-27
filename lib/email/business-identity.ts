// lib/email/business-identity.ts -- who an email says it is from, and whether
// this tenant may send one at all.
//
// SIDE-EFFECT FREE ON PURPOSE. Nothing here imports the mail SDK, reads the
// environment or touches the database, so both mail paths can share it:
// lib/lead-engine/email.ts (the sequence engine, which builds its Resend
// client at module scope) and lib/email/lead-alerts.ts (the transactional lead
// alerts, reached from routes that must not die at import time when no API key
// is set).
//
// `assertSendable` and `BusinessNotConfiguredError` were MOVED here from
// lib/lead-engine/email.ts, which re-exports both so every existing importer
// is unchanged. They are not copies: a second sendability rule that drifted
// from the first is precisely the failure this file prevents.
//
// NO BRAND NAMES IN THIS FILE, comments included.

import type { BusinessSettings } from "@/lib/db/businesses"

/**
 * Thrown by `assertSendable` when `business_settings` has not been filled in.
 *
 * A subclass rather than a bare Error so a caller can answer "this business is
 * not configured" instead of 500 -- `POST /api/admin/internal/sequence-tick`
 * catches it by type.
 */
export class BusinessNotConfiguredError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(`business_settings not configured: ${missing.join(", ")}`)
    this.name = "BusinessNotConfiguredError"
    this.missing = missing
  }
}

/**
 * Preflight for the whole send path. Migration 00212 seeds every identity
 * column as `NOT NULL DEFAULT ''` and nothing in this codebase calls
 * `updateBusinessSettings`, so an untouched install would send
 * `from: " <>"` with an empty postal address -- Resend rejects it, and every
 * run that reached the provider would be marked permanently `failed` with no
 * re-activation path.
 *
 * Called BEFORE any run is claimed (see `runSequenceTick`) precisely so that
 * an unconfigured business claims nothing and fails nothing.
 *
 * The three fields checked here are the ones whose emptiness is fatal or
 * unlawful: `sender_email` (Resend rejects an empty From address),
 * `display_name` (the email would identify nobody) and `postal_address`
 * (CAN-SPAM requires a physical address in every commercial message).
 *
 * `reply_to` is deliberately NOT on this list, and neither is `alert_email`.
 * For sequence mail `reply_to` is a courtesy; for an operator alert
 * `alert_email`/`reply_to` together ARE the destination, and a missing one
 * there is "there was nobody to tell", not "this tenant may not send" -- a
 * different answer, owed to a different caller. `alertAddressing` below is
 * where that question is asked.
 */
export function assertSendable(settings: BusinessSettings): void {
  const missing: string[] = []
  if (!settings.sender_email?.trim()) missing.push("sender_email")
  if (!settings.display_name?.trim()) missing.push("display_name")
  if (!settings.postal_address?.trim()) missing.push("postal_address")
  if (missing.length > 0) throw new BusinessNotConfiguredError(missing)
}

/**
 * The `From` header for this tenant, in the one spelling both mail paths use.
 *
 * NOT TRIMMED, deliberately: this is the string lib/lead-engine/email.ts has
 * been sending in production since migration 00212, and `assertSendable` above
 * has already refused the blank case that trimming would change the shape of.
 * A tidy-up here would alter live headers for no stated reason.
 */
export function businessFrom(settings: BusinessSettings): string {
  return `${settings.sender_name} <${settings.sender_email}>`
}

/**
 * The tenant's own `reply_to`, trimmed, or null when nobody has filled one in.
 *
 * NAMED FOR EXACTLY WHAT IT RETURNS, deliberately, since migration 00282
 * ("Alert email") review round 1: the old name, `alertRecipient`, invited a
 * future caller to reach for it whenever they wanted "where does a coach
 * alert go" -- which stopped being `reply_to` alone the day `alert_email`
 * shipped. Before `alert_email` existed this WAS the operator-alert
 * destination -- every coach alert went `to: reply_to`. It no longer is:
 * `alertAddressing` below is the one place that decides where a coach alert
 * goes, and it reads `alert_email` first.
 *
 * What still needs THIS function, specifically, is
 * `sendInquiryAutoReply`'s `Reply-To` header (lib/email/lead-alerts.ts,
 * `const replyTo = replyToAddress(settings)`): the applicant's auto-reply
 * must keep landing a reply at `reply_to`, never `alert_email`, because
 * `alert_email` can be a distribution mailbox nobody reads FROM (`sales@`
 * cannot receive a reply meant for a human). If another caller needs "the
 * reply_to address" for a similar reason, this is the function to reach for
 * -- but a caller that wants to know where a COACH ALERT should go must use
 * `alertAddressing`, not this, or it will quietly stop honouring
 * `alert_email` the day someone points it here by habit.
 *
 * Null rather than an empty string because the empty string satisfies
 * `to: string` and is a hard provider error at send time -- and a provider
 * rejection is indistinguishable from a mailbox that refused the message,
 * which is how "nobody configured an address" gets mistaken for "delivery
 * failed".
 */
export function replyToAddress(settings: BusinessSettings): string | null {
  const replyTo = settings.reply_to?.trim()
  return replyTo ? replyTo : null
}

/**
 * Where a COACH ALERT goes (migration 00282, "Alert email"): quiz results,
 * chat handovers, chat leads, new applications, new funnel leads, and the
 * sequence engine's own "have you replied?" reminder.
 *
 * `alert_email` is what the owner asked for: a single mailbox (e.g. a
 * `sales@` distribution address) that gets EVERY new-lead alert, with the
 * tenant's own `reply_to` (their personal inbox) copied so nothing is missed
 * twice. `reply_to` stays the sole destination when `alert_email` is unset --
 * that is the pre-00282 behaviour, unchanged, which is what a fixture with no
 * `alert_email` field at all proves by continuing to pass.
 *
 * `alert_email` is read from a per-tenant COLUMN, never an environment
 * variable -- see the white-label note in this repo's CLAUDE.md: an env var
 * is a single-tenant assumption wearing a config file's clothes, and this
 * product is headed toward one coach per row, not one coach per deploy.
 *
 * Returns:
 *  - `{ to: alert_email, cc: reply_to }` when both are set and DIFFER
 *    case-insensitively (Resend, like every mail system, treats an address's
 *    case as cosmetic; CCing a mailbox on itself is a no-op that just makes
 *    the header longer and confuses a reply-all).
 *  - `{ to: alert_email }` (no `cc`) when `alert_email` is set and `reply_to`
 *    is blank or equal to it.
 *  - `{ to: reply_to }` when `alert_email` is blank, null or undefined
 *    (undefined covers a `business_settings` row read before the migration
 *    added the column) -- today's behaviour, unchanged.
 *  - `null` when BOTH are blank: there is nobody to tell. Every caller must
 *    treat `null` as "skip the send", the same way `replyToAddress` returning
 *    null always has -- an empty string would satisfy `to: string` and reach
 *    the provider as a rejection, misfiling "nobody configured an address" as
 *    "delivery failed".
 */
export function alertAddressing(settings: BusinessSettings): { to: string; cc?: string } | null {
  const alertEmail = settings.alert_email?.trim()
  const replyTo = settings.reply_to?.trim()

  if (alertEmail) {
    return replyTo && replyTo.toLowerCase() !== alertEmail.toLowerCase()
      ? { to: alertEmail, cc: replyTo }
      : { to: alertEmail }
  }

  return replyTo ? { to: replyTo } : null
}
