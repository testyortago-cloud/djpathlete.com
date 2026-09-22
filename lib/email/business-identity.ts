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
 * `reply_to` is deliberately NOT on this list. For sequence mail it is a
 * courtesy; for an operator alert it is the DESTINATION, and a missing one
 * there is "there was nobody to tell", not "this tenant may not send" -- a
 * different answer, owed to a different caller. `alertRecipient` below is
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
 * Where an OPERATOR ALERT goes: the tenant's own `reply_to`, or null when
 * nobody has filled one in.
 *
 * Null rather than an empty string because the empty string satisfies
 * `to: string` and is a hard provider error at send time -- and a provider
 * rejection is indistinguishable from a mailbox that refused the message,
 * which is how "nobody configured an address" gets mistaken for "delivery
 * failed". The callers answer those two differently.
 */
export function alertRecipient(settings: BusinessSettings): string | null {
  const replyTo = settings.reply_to?.trim()
  return replyTo ? replyTo : null
}
