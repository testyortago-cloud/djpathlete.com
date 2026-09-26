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
export async function claimDueRuns(limit: number, claimToken: string, businessId: string): Promise<SequenceRunRow[]> {
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
export async function loadRunContext(run: SequenceRunRow, now: Date, businessId: string): Promise<DecisionContext> {
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
  //
  // Under THIS run's business (G35), the same tenant every read above is
  // scoped to. `contact_consents` has no composite key tying a consent row's
  // business to its contact's, so the contact read above belonging to
  // `businessId` proves nothing about which business a consent row for that
  // contact id was filed under.
  const [hasEmailConsent, hasSmsConsent] = await Promise.all([
    hasConsent(run.contact_id, "email", businessId),
    hasConsent(run.contact_id, "sms", businessId),
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

  // Every post-send lifecycle status a message row can carry, NOT just
  // "sent" — applyDeliveryStatus (below) overwrites "sent" with
  // "delivered"/"undelivered"/"failed" the moment Twilio's status callback
  // lands, so a `.eq("status", "sent")` filter here would stop counting a
  // message toward today's cap the instant it got delivered, letting a
  // sibling sequence message the same contact again the same day. Pre-send
  // failures (a message that never left `queued`) are excluded for free:
  // they never got a `sent_at`, and the `sent_at` bounds below already
  // require a non-null value inside today's window.
  const { data: sentRows, error: sentErr } = await supabase
    .from("sequence_messages")
    .select("sent_at")
    .eq("contact_id", run.contact_id)
    .eq("business_id", businessId)
    .in("status", ["sent", "delivered", "undelivered", "failed"])
    .gte("sent_at", start.toISOString())
    .lt("sent_at", end.toISOString())
  if (sentErr) throw sentErr

  // G09: the most recent email THIS run sent, and what Resend has since said
  // about it. Scoped to the run, not the contact — "did they open the last
  // email" means the last one from this sequence, not the last one from any.
  //
  // `sent_at IS NOT NULL` IS THE LOAD-BEARING FILTER, not the status list.
  // `markFailed` writes status `failed` WITHOUT a `sent_at` — a message that
  // never left — and PostgREST's `order=sent_at.desc` is Postgres's
  // `ORDER BY sent_at DESC`, which is NULLS **FIRST**. So a run holding one
  // pre-send failure would read that row as "the last email" and both
  // engagement predicates would be false forever. Not a corner case: on
  // production 73 of the 77 email rows are exactly this shape (the stranded
  // sms_repermission batch), 73 of 73 with a null `sent_at`.
  const { data: lastEmailRows, error: lastEmailErr } = await supabase
    .from("sequence_messages")
    .select("opened_at, clicked_at, sent_at")
    .eq("run_id", run.id)
    .eq("business_id", businessId)
    .eq("channel", "email")
    .in("status", ["sent", "delivered", "undelivered", "failed"])
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
  if (lastEmailErr) throw lastEmailErr
  const lastEmailRow = ((lastEmailRows ?? []) as Array<{ opened_at: string | null; clicked_at: string | null }>)[0]
  const lastEmail = lastEmailRow
    ? { openedAt: lastEmailRow.opened_at ?? null, clickedAt: lastEmailRow.clicked_at ?? null }
    : null

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
    lastEmail,
    // G10. No query: `claim_sequence_runs` is
    // `RETURNS SETOF public.sequence_runs ... RETURNING r.*`, so the claimed
    // row already carries the column that migration 00266 adds — verified
    // against the database, not assumed.
    //
    // `?? {}`, deliberately, and NOT a `!== null` test: for the one deploy
    // where the build is live and the migration is not, the key is ABSENT
    // from the row rather than null, and `undefined !== null` is true. That
    // exact confusion cost this repo a deploy once already (migration 00210).
    enrolmentMetadata: run.enrolment_metadata ?? {},
    // G11, and the same no-query reasoning as the line above: the claimed row
    // already carries the column migration 00267 adds.
    //
    // `?? null` rather than a bare read, for the same one-deploy window: an
    // absent key is `undefined`, and `undefined` is not `null`. A run that
    // reached an anchored wait with `undefined` here would take neither the
    // "no anchor" branch nor the arithmetic — it would build a Date from
    // undefined, which is Invalid, and comparisons against it are all false.
    anchorAt: run.anchor_at ?? null,
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
  businessId: string
}): Promise<{ claimed: boolean; messageId: string | null }> {
  const supabase = getClient()
  const businessId = args.businessId

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

/**
 * Twilio status callback -> `sequence_messages.status` mapping. `sent`,
 * `queued` and `accepted` map to nothing (`undefined`): `markSent` already
 * recorded `status='sent'` at send time, so those callbacks carry no
 * delivery-lifecycle information this table doesn't already have. Any other
 * Twilio status this repo doesn't specifically track (e.g. `sending`,
 * `receiving`) falls through the same way — `applyDeliveryStatus` below
 * treats an unmapped status as `"ignored"`, never as an error, so a future
 * Twilio status this code doesn't know about can't turn a webhook into a
 * throw.
 */
const DELIVERY_STATUS_MAP: Record<string, "delivered" | "undelivered" | "failed"> = {
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
}

/**
 * Who a sent email actually went to, and under which business (G09).
 *
 * Exists for exactly one caller: the bounce arm of the Resend webhook, which
 * must suppress an address and therefore needs both. Suppression is keyed on
 * the IDENTIFIER rather than the contact — so it survives a merge — which
 * means nothing in the suppression itself carries a business, and the message
 * row is the only honest source of one.
 *
 * BOTH come from the ROW rather than the webhook payload. The address in a
 * bounce report is not always the address we sent to (a forwarder, or an
 * `Undetermined` bounce naming the wrong mailbox), and suppressing the wrong
 * one silences a lead who never bounced.
 *
 * `null` when no sequence message matches, and the caller must then suppress
 * NOTHING. Guessing a tenant here would be a cross-tenant write driven by an
 * unauthenticated endpoint.
 */
export async function sequenceMessageRecipient(
  providerMessageId: string,
): Promise<{ businessId: string; toIdentifier: string } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("sequence_messages")
    .select("business_id, to_identifier")
    .eq("provider_message_id", providerMessageId)
    .eq("provider", "resend")
    .maybeSingle()
  if (error) throw error
  const row = data as { business_id: string; to_identifier: string } | null
  return row ? { businessId: row.business_id, toIdentifier: row.to_identifier } : null
}

/**
 * What Resend can tell us about an email after it left (G09).
 *
 * `delivered_at` / `opened_at` / `clicked_at` have existed since 00216 and had
 * NO writer, which is why the quotation's "branch on whether they opened the
 * last email" could never be true: the column it would read was always null.
 *
 * FIRST WINS on every timestamp, which is the opposite of `applyDeliveryStatus`
 * above and deliberate. A Twilio status is a lifecycle that moves forward, so
 * the LATEST report is the truth. An open is an event that repeats: a mail
 * client re-opened weeks later fires again, and Apple Mail Privacy Protection
 * re-fetches the pixel on its own schedule. The question worth answering is
 * "did this message land", so the first occurrence is the answer and a later
 * one must not move it.
 *
 * A BOUNCE marks the row `failed`. Suppressing the ADDRESS is the caller's
 * job, not this function's — suppression is keyed on the identifier rather
 * than the message (so it survives a merge), and the route has the contact in
 * hand while this function deliberately knows only about one message row.
 *
 * `unknown_message` is the COMMON case, not an error: Resend sends an event
 * for every email the account sends, and most of them are transactional mail
 * with no `sequence_messages` row at all. The route answers 200 to those —
 * a non-2xx would make Svix retry a delivery that can never match.
 */
export async function applyResendEmailEvent(
  providerMessageId: string,
  kind: "delivered" | "opened" | "clicked" | "bounced",
  occurredAt: Date,
): Promise<"updated" | "ignored" | "unknown_message"> {
  const supabase = getClient()

  const { data: existing, error: readErr } = await supabase
    .from("sequence_messages")
    .select("id, status, delivered_at, opened_at, clicked_at")
    // `provider` as well as the id: a Twilio SID and a Resend id live in the
    // same column, and nothing stops one colliding with the other.
    .eq("provider_message_id", providerMessageId)
    .eq("provider", "resend")
    .maybeSingle()
  if (readErr) throw readErr
  if (!existing) return "unknown_message"

  const row = existing as {
    id: string
    status: string
    delivered_at: string | null
    opened_at: string | null
    clicked_at: string | null
  }
  const at = occurredAt.toISOString()

  let patch: Record<string, unknown> | null = null
  if (kind === "delivered") {
    // The TIMESTAMP is first-wins; the STATUS is only advanced from `sent`.
    // Svix retries, so a `delivered` redelivered after a `bounced` (or after
    // markFailed) would otherwise flip a failed row back to delivered and
    // un-say the bounce.
    if (row.delivered_at === null) {
      patch = { delivered_at: at, ...(row.status === "sent" ? { status: "delivered" } : {}) }
    }
  } else if (kind === "opened") {
    if (row.opened_at === null) patch = { opened_at: at }
  } else if (kind === "clicked") {
    if (row.clicked_at === null) patch = { clicked_at: at }
  } else {
    if (row.status !== "failed") patch = { status: "failed" }
  }

  if (!patch) return "ignored"

  const { error: updateErr } = await supabase.from("sequence_messages").update(patch).eq("id", row.id)
  if (updateErr) throw updateErr
  return "updated"
}

/**
 * Applies one Twilio status callback to the `sequence_messages` row it
 * refers to. Called from app/api/webhooks/twilio/status/route.ts once the
 * request's signature has already been verified — this function does no
 * verification of its own.
 *
 * MONOTONIC: `delivered` is terminal. Once a row is `delivered`, no later
 * callback of any kind changes it — Twilio callbacks can arrive out of
 * order, and a `failed`/`undelivered` callback that lands after a
 * `delivered` one is a stale, superseded report, not new information.
 * Conversely a `delivered` callback overwrites `sent`, `failed` OR
 * `undelivered` — a late delivery beats an earlier pessimistic callback,
 * which is exactly the "arrived out of order" case this whole function
 * exists to handle correctly.
 *
 * THE READ-THEN-WRITE RACE (deliberately not closed by a transaction): two
 * concurrent callbacks for the same message could both read the row before
 * either writes. Worst case, both then issue the same idempotent write (e.g.
 * both apply `delivered`) — never a downgrade, because the UPDATE below
 * carries its own `.neq("status", "delivered")` guard. That guard is the
 * real safety property: even a stale in-memory read that thinks the row is
 * still `sent` cannot un-deliver a row the database already knows is
 * `delivered`, because the guard is evaluated against the current row at
 * UPDATE time, not against this function's earlier read. The in-code check
 * above (skipping the write entirely once `existing.status === "delivered"`)
 * is a preflight for the common case, not the actual safety mechanism — it
 * exists to avoid an entirely unnecessary write, not to prevent a downgrade.
 */
export async function applyDeliveryStatus(
  providerMessageId: string,
  twilioStatus: string,
): Promise<"updated" | "ignored" | "unknown_message"> {
  const supabase = getClient()

  const { data: existing, error: readErr } = await supabase
    .from("sequence_messages")
    .select("id, status")
    .eq("provider_message_id", providerMessageId)
    .eq("provider", "twilio")
    .maybeSingle()
  if (readErr) throw readErr
  if (!existing) return "unknown_message"

  const row = existing as { id: string; status: string }
  const target = DELIVERY_STATUS_MAP[twilioStatus]

  // Nothing to apply (sent/queued/accepted/unmapped), or the row is already
  // terminal — either way, no write.
  if (!target || row.status === "delivered") return "ignored"

  const { error: updateErr } = await supabase
    .from("sequence_messages")
    .update({
      status: target,
      ...(target === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
    })
    .eq("id", row.id)
    // The in-database guard against the read-then-write race described
    // above — see the mutation check in task-4-brief.md Step 5, which
    // removes this filter (and the in-code `row.status === "delivered"`
    // check above) specifically to prove the monotonic test fails without
    // it.
    .neq("status", "delivered")
  if (updateErr) throw updateErr

  return "updated"
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
 * Why `reason` is a union and not `string`: the third parameter is a business
 * id, and before this change the signature was (contactId, reason) — so a
 * caller passing a business id second would type-check, write a uuid into
 * exit_reason, and apply no tenant predicate at all. Typing the reason is what
 * lets tsc police the mistake this parameter exists to prevent.
 */
export type SequenceExitReason = "booking" | "unsubscribed" | "sms_stop" | "payment"

/**
 * Exits every ACTIVE run of the given contact, across every sequence. Used
 * by every exit hook (unsubscribe, payment, booking, tick-time suppression
 * check) and MUST be idempotent and safe to call with nothing to exit — a
 * marketing exit must never fail a payment webhook.
 *
 * Filtered by `contact_id`, `business_id`, and `status = 'active'`: a
 * completed, already-exited or failed run of this contact, any active run of
 * a DIFFERENT contact, and any active run of the same contact_id belonging
 * to a DIFFERENT business — must all be left untouched.
 */
export async function exitRunsForContact(
  contactId: string,
  reason: SequenceExitReason,
  businessId: string,
): Promise<number> {
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
    .eq("business_id", businessId)
    .eq("status", "active")
    .select("id")
  if (error) throw error
  return (data ?? []).length
}

/**
 * One row per sequence, for a human to pick from.
 *
 * `status` and `trigger_source` are part of the row rather than a detail a
 * caller can skip, because together they are the two things a person choosing
 * a sequence by hand actually needs to know:
 *
 *   - `status` — every sequence in this repo is SEEDED `draft` on purpose
 *     (migrations 00218 and 00223 both open with the reason), and
 *     `enrolContactManually` refuses a sequence that is not `active`. A picker
 *     that showed only a name would let someone select four contacts, click
 *     enrol, and be told afterwards that nothing happened. Showing the status
 *     turns that into something they knew before they clicked.
 *   - `trigger_source` — NULL means "manual enrolment only" (migration 00216's
 *     own comment), i.e. this surface is the ONLY way anyone ever gets into it.
 *     A non-NULL source means the sequence also enrols people automatically,
 *     which is worth knowing before adding more by hand.
 *
 * Deliberately NOT filtered to `status = 'active'`: that would render an empty
 * picker today, on a database where every seeded sequence is a draft, and an
 * empty picker reads as a broken feature rather than as an unactivated one.
 */
export interface SequenceSummary {
  id: string
  key: string
  name: string
  status: string
  trigger_source: string | null
}

export async function listSequences(businessId: string): Promise<SequenceSummary[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("sequences")
    .select("id, key, name, status, trigger_source")
    .eq("business_id", businessId)
    .order("name", { ascending: true })
  // Throws rather than returning []: an empty picker for a failed read would
  // tell the operator this business has no sequences, which is not true.
  if (error) throw new Error(`listSequences: ${error.message}`)
  return (data ?? []) as SequenceSummary[]
}
