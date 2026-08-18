// lib/db/sequences.ts — the IO layer for the Lead Engine sequence engine.
//
// `lib/automation/sequence-tick.ts` (Task 3) is the pure decision core: given
// a run, its steps and a `DecisionContext`, it returns exactly one
// `StepAction`. This file is everything around that pure call — claiming due
// runs, assembling `DecisionContext` from the database, and writing back the
// outcome. It imports the pure module's row/context types unchanged rather
// than redeclaring them.
//
// SEND IDEMPOTENCY IS AT-LEAST-ONCE, NOT EXACTLY-ONCE. See `recordSend` below.
// Do not describe it as exactly-once anywhere — the alternative (never
// retrying a crashed send) stalls a sequence forever on a single crash.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { resolveTimezone, localDayBounds } from "@/lib/lead-engine/guardrails"
import { hasConsent, isSuppressed } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import type { SequenceRunRow, SequenceStepRow, DecisionContext } from "@/lib/automation/sequence-tick"

function getClient() {
  return createServiceRoleClient()
}

const RECLAIM_WINDOW_MS = 15 * 60 * 1000

/**
 * Atomically claims up to `limit` due runs via the `claim_sequence_runs`
 * plpgsql function (migration 00217), which uses `FOR UPDATE SKIP LOCKED`
 * under the hood. This MUST stay a single RPC call — a read-then-write
 * implementation in application code cannot be made safe against two
 * overlapping ticks claiming the same run, which is the entire reason the
 * function exists in the database rather than here.
 */
export async function claimDueRuns(
  limit: number,
  claimToken: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<SequenceRunRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("claim_sequence_runs", {
    p_business_id: businessId,
    p_limit: limit,
    p_claim_token: claimToken,
  })
  if (error) throw error
  return (data ?? []) as SequenceRunRow[]
}

export async function loadSteps(sequenceId: string): Promise<SequenceStepRow[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("position", { ascending: true })
  if (error) throw error
  return (data ?? []) as SequenceStepRow[]
}

/**
 * Assembles the `DecisionContext` the pure `decideStep` needs to evaluate a
 * run: resolved timezone and quiet hours, the daily message cap and today's
 * local-day sent count, the oldest active sibling run, per-channel consent,
 * suppression state, and the source that triggered enrolment.
 *
 * `now` is a required parameter, not read from the clock in here — a DAL
 * cannot invent the tick's clock, and every guardrail this context feeds
 * depends on `now` being injectable so tests can pin an instant.
 *
 * `hasConsent` and `isSuppressed` (lib/db/contact-consents.ts) both throw on
 * a read failure by design, and that throw is deliberately NOT caught here.
 * A failed consent or suppression read is not "no consent" / "not
 * suppressed" — those are different answers, and only one of them is safe to
 * act on. Letting it propagate fails the run visibly (`status='failed'`)
 * rather than sending or exiting on a guess.
 */
export async function loadRunContext(
  run: SequenceRunRow,
  now: Date,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<DecisionContext> {
  const supabase = getClient()

  const settings = await getBusinessSettings(businessId)

  const { data: contactRow, error: contactErr } = await supabase
    .from("contacts")
    .select("email, phone_e164, user_id, timezone, name")
    .eq("id", run.contact_id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (contactErr) throw contactErr
  if (!contactRow) throw new Error(`contact ${run.contact_id} not found for run ${run.id}`)

  const { data: sequenceRow, error: sequenceErr } = await supabase
    .from("sequences")
    .select("trigger_source")
    .eq("id", run.sequence_id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (sequenceErr) throw sequenceErr
  if (!sequenceRow) throw new Error(`sequence ${run.sequence_id} not found for run ${run.id}`)

  const contact = {
    email: (contactRow.email as string | null) ?? null,
    phone_e164: (contactRow.phone_e164 as string | null) ?? null,
    user_id: (contactRow.user_id as string | null) ?? null,
    name: (contactRow.name as string | null) ?? null,
  }

  // Do not wrap these in try/catch. See the doc comment above.
  const [hasEmailConsent, hasSmsConsent] = await Promise.all([
    hasConsent(run.contact_id, "email"),
    hasConsent(run.contact_id, "sms"),
  ])

  // Suppression is keyed by identifier, not contact id (it must survive a
  // merge). Check whichever identifiers this contact actually has; either
  // one being suppressed suppresses the whole run.
  let suppressed = false
  if (contact.email) {
    suppressed = await isSuppressed(contact.email, businessId)
  }
  if (!suppressed && contact.phone_e164) {
    suppressed = await isSuppressed(contact.phone_e164, businessId)
  }

  const timezone = resolveTimezone(contactRow.timezone as string | null, settings.timezone)
  const { start, end } = localDayBounds(now, timezone)

  const { data: sentRows, error: sentErr } = await supabase
    .from("sequence_messages")
    .select("sent_at")
    .eq("contact_id", run.contact_id)
    .eq("business_id", businessId)
    .eq("status", "sent")
    .gte("sent_at", start.toISOString())
    .lt("sent_at", end.toISOString())
  if (sentErr) throw sentErr

  const { data: siblingRows, error: siblingErr } = await supabase
    .from("sequence_runs")
    .select("id, enrolled_at")
    .eq("contact_id", run.contact_id)
    .eq("business_id", businessId)
    .eq("status", "active")
  if (siblingErr) throw siblingErr

  const activeSiblings = ((siblingRows ?? []) as Array<{ id: string; enrolled_at: string }>).filter(
    (sibling) => sibling.id !== run.id,
  )

  return {
    now,
    timezone,
    quiet: { startHour: settings.quiet_hours_start, endHour: settings.quiet_hours_end },
    dailyCap: settings.daily_message_cap,
    sentAtToday: ((sentRows ?? []) as Array<{ sent_at: string | null }>)
      .map((r) => r.sent_at)
      .filter((v): v is string => v !== null),
    activeSiblings,
    contact,
    hasEmailConsent,
    hasSmsConsent,
    isSuppressed: suppressed,
    enrolledSource: (sequenceRow.trigger_source as string | null) ?? null,
  }
}

/**
 * The send-path idempotency gate. THIS IS AT-LEAST-ONCE, NOT EXACTLY-ONCE.
 *
 * The `sequence_messages` row is inserted with `status='queued'` BEFORE any
 * provider is called:
 *
 *  - Insert succeeds  -> `{ claimed: true, messageId }`. Caller sends.
 *  - Insert 23505s     -> a row already exists for `(run_id, step_id)` (the
 *    unique index `sequence_messages_idem`). Read it:
 *      - still `queued`, `provider_message_id IS NULL`, and `created_at`
 *        older than 15 minutes -> a prior attempt crashed between insert and
 *        send. Re-claim it: `{ claimed: true, messageId: <existing id> }`.
 *      - anything else (already sent/failed/skipped, or queued but too
 *        young to call crashed) -> `{ claimed: false, messageId: null }`.
 *        The caller skips; some other tick has it or already finished it.
 *  - Insert fails with any other error -> throw. A read failure or a
 *    constraint violation on a different column is not "already sent" and
 *    must never be swallowed into a duplicate verdict.
 *
 * The 15-minute window means a message that really did crash mid-send can be
 * retried and, in a pathological case, delivered twice. That is the accepted
 * tradeoff: the alternative is a sequence that stalls forever on one crash.
 */
export async function recordSend(args: {
  runId: string
  stepId: string
  contactId: string
  channel: "email" | "sms"
  toIdentifier: string
  subject: string | null
  bodyRendered: string
  businessId?: string
}): Promise<{ claimed: boolean; messageId: string | null }> {
  const supabase = getClient()
  const businessId = args.businessId ?? SINGLETON_BUSINESS_ID

  const { data: inserted, error: insertErr } = await supabase
    .from("sequence_messages")
    .insert({
      business_id: businessId,
      run_id: args.runId,
      step_id: args.stepId,
      contact_id: args.contactId,
      channel: args.channel,
      to_identifier: args.toIdentifier,
      subject: args.subject,
      body_rendered: args.bodyRendered,
      status: "queued",
      provider_message_id: null,
    })
    .select("id")
    .single()

  if (!insertErr) {
    return { claimed: true, messageId: (inserted as { id: string }).id }
  }

  if (insertErr.code !== "23505") throw insertErr

  // Another claim (or a prior attempt of this one) already inserted the row.
  // Read it to decide whether it is live or crashed.
  const { data: existing, error: readErr } = await supabase
    .from("sequence_messages")
    .select("id, status, provider_message_id, created_at")
    .eq("run_id", args.runId)
    .eq("step_id", args.stepId)
    .maybeSingle()
  if (readErr) throw readErr
  if (!existing) return { claimed: false, messageId: null }

  const row = existing as { id: string; status: string; provider_message_id: string | null; created_at: string }
  const ageMs = Date.now() - new Date(row.created_at).getTime()
  const isCrashedAttempt = row.status === "queued" && row.provider_message_id === null && ageMs > RECLAIM_WINDOW_MS

  if (isCrashedAttempt) return { claimed: true, messageId: row.id }
  return { claimed: false, messageId: null }
}

export async function markSent(messageId: string, provider: string, providerMessageId: string | null): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("sequence_messages")
    .update({
      status: "sent",
      provider,
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageId)
  if (error) throw error
}

export async function markFailed(messageId: string, error: string): Promise<void> {
  const supabase = getClient()
  const { error: dbError } = await supabase
    .from("sequence_messages")
    .update({ status: "failed", error })
    .eq("id", messageId)
  if (dbError) throw dbError
}

// advanceRun/deferRun/exitRun/completeRun/failRun all clear claimed_at and
// claimed_by, releasing the run back into the claim pool immediately.
//
// This matters: `claim_sequence_runs` treats a run as re-claimable once
// `claimed_at < now() - interval '10 minutes'`. That window exists to
// recover a run stranded by a tick that died mid-batch. If a tick that did
// NOT die left `claimed_at` set after writing its outcome, a short guardrail
// defer (e.g. the 5-minute sibling-run defer) would be silently stretched to
// ~10 minutes by the stale-claim window, even though `next_run_at` says the
// run is due sooner. Clearing the claim on every write is what makes
// `next_run_at` the only thing that governs when a run is next picked up.

/**
 * The one `defer_reason` that means "this run threw and we are retrying it",
 * as opposed to a guardrail holding a healthy run back. Exported because
 * `deferRun` treats it specially (it is the only reason that does NOT reset
 * `attempts`) and the runner must not spell it differently.
 */
export const TRANSIENT_ERROR_DEFER_REASON = "transient_error"

export async function advanceRun(runId: string, toPosition: number, deferUntil?: Date): Promise<void> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from("sequence_runs")
    .update({
      current_position: toPosition,
      next_run_at: deferUntil ? deferUntil.toISOString() : nowIso,
      // Forward progress clears both notes: a defer that has resolved is no
      // longer worth surfacing, and a prior error (if this advance follows
      // one) is superseded by the run actually moving.
      defer_reason: null,
      last_error: null,
      // ...and the retry budget with them. `claim_sequence_runs` increments
      // `attempts` on every claim, so without this reset a healthy long-lived
      // run accumulates attempts simply by existing, and the runner's
      // "attempts < MAX_ATTEMPTS" retry budget would be spent before the run
      // ever hit a real error. Resetting on progress is also exactly what
      // migration 00217's comment assumes: "attempts climbing without
      // current_position moving is the signature of a poison run".
      attempts: 0,
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
    })
    .eq("id", runId)
  if (error) throw error
}

/**
 * Writes to `defer_reason`, NEVER `last_error`. A deferred run stays
 * `active` — sitting out quiet hours overnight or behind the daily cap is
 * this engine's normal steady state, not a failure. `last_error` is
 * `failRun`'s column exclusively; overloading it here would make every
 * quiet night indistinguishable from a genuine crash to anything reading
 * "WHERE last_error IS NOT NULL" (this repo's automation-health-scanner
 * already reads exactly that pattern elsewhere).
 */
export async function deferRun(runId: string, until: Date, reason: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("sequence_runs")
    .update({
      next_run_at: until.toISOString(),
      defer_reason: reason,
      claimed_at: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
      // A guardrail defer — quiet hours, the daily cap, a sibling run — is
      // this engine's normal steady state and did not attempt anything, so it
      // must not spend the runner's transient-error retry budget. Only a
      // transient-error defer leaves `attempts` climbing, which is what makes
      // it a count of CONSECUTIVE failures rather than of lifetime claims.
      ...(reason === TRANSIENT_ERROR_DEFER_REASON ? {} : { attempts: 0 }),
    })
    .eq("id", runId)
  if (error) throw error
}

export async function exitRun(runId: string, reason: string): Promise<void> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from("sequence_runs")
    .update({
      status: "exited",
      exit_reason: reason,
      completed_at: nowIso,
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
    })
    .eq("id", runId)
  if (error) throw error
}

export async function completeRun(runId: string): Promise<void> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from("sequence_runs")
    .update({
      status: "completed",
      completed_at: nowIso,
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
    })
    .eq("id", runId)
  if (error) throw error
}

export async function failRun(runId: string, error: string): Promise<void> {
  const supabase = getClient()
  const { error: dbError } = await supabase
    .from("sequence_runs")
    .update({
      status: "failed",
      last_error: error,
      claimed_at: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
  if (dbError) throw dbError
}

/**
 * Exits every ACTIVE run of the given contact, across every sequence. Used
 * by every exit hook (unsubscribe, payment, booking, tick-time suppression
 * check) and MUST be idempotent and safe to call with nothing to exit — a
 * marketing exit must never fail a payment webhook.
 *
 * Filtered by both `contact_id` and `status = 'active'`: a completed,
 * already-exited or failed run of this contact — and any active run of a
 * DIFFERENT contact — must be left untouched.
 */
export async function exitRunsForContact(contactId: string, reason: string): Promise<number> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from("sequence_runs")
    .update({
      status: "exited",
      exit_reason: reason,
      completed_at: nowIso,
      claimed_at: null,
      claimed_by: null,
      updated_at: nowIso,
    })
    .eq("contact_id", contactId)
    .eq("status", "active")
    .select("id")
  if (error) throw error
  return (data ?? []).length
}
