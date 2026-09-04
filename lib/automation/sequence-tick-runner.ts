// lib/automation/sequence-tick-runner.ts — the IO shell around the pure
// decision core (`lib/automation/sequence-tick.ts`, Task 3).
//
// Task 3's module must import no database client — that purity is why its
// guardrail and decision tests need no mocks. This file is where the
// database, the email sender and the pure decision function actually meet.
// It is a controller ruling (R1, task-8-brief.md) that `runSequenceTick`
// lives HERE and not in sequence-tick.ts, even though the brief text once
// suggested otherwise. It is deliberately listed in
// __tests__/lib/lead-engine/no-brand-literals.test.ts's ROOTS.
//
// CONCURRENCY CONTRACT (controller ruling R12, task-8-brief.md): exactly ONE
// write-back to `sequence_runs` per run per tick invocation. `advanceRun` /
// `deferRun` / `exitRun` / `completeRun` / `failRun` (lib/db/sequences.ts)
// all clear `claimed_at`/`claimed_by` on write, specifically so a short
// guardrail defer is never silently stretched to the claim RPC's 10-minute
// stale-claim window. Looping here over consecutive no-defer `advance`
// actions — to "finish" a branch/tag hop in one tick — would clear that
// claim mid-batch and reopen exactly the race `FOR UPDATE SKIP LOCKED`
// exists to close. So: one decideStep call, one write-back, per run, full
// stop. A multi-hop sequence costs a few extra 5-minute ticks instead of
// resolving instantly. That is the accepted cost — no Stage 1b seed
// sequence chains such steps.

import { randomUUID } from "crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { getBusinessSettings, listBusinesses, type BusinessSettings } from "@/lib/db/businesses"
import {
  assertSendable,
  classifySendFault,
  SequenceSendError,
  emailEnvPresent,
  renderSequenceEmail,
  sendRenderedSequenceEmail,
  sendSequenceEmail,
} from "@/lib/lead-engine/email"
import { smsConfigured, smsEnvPresent, renderSequenceSms, sendRenderedSequenceSms } from "@/lib/lead-engine/sms"
import { unsubscribeUrl, unsubscribeOneClickUrl } from "@/lib/lead-engine/unsubscribe-token"
import { smsConsentUrl } from "@/lib/lead-engine/sms-consent-token"
import { appOrigin } from "@/lib/lead-engine/origin"
import { decideStep } from "@/lib/automation/sequence-tick"
import type { SequenceRunRow } from "@/lib/automation/sequence-tick"
import {
  claimDueRuns,
  loadSteps,
  loadRunContext,
  recordSend,
  markSent,
  markFailed,
  advanceRun,
  deferRun,
  TRANSIENT_ERROR_DEFER_REASON,
  exitRun,
  completeRun,
  failRun,
} from "@/lib/db/sequences"

export type TickSummary = {
  claimed: number
  sent: number
  deferred: number
  exited: number
  completed: number
  failed: number
  /**
   * Runs deferred because the PROVIDER was misconfigured, not because
   * anything about the contact was wrong. Counted apart from `deferred`
   * because it is the one deferral that means a human must act: it repeats
   * every tick until somebody fixes the setting, and once MAX_ATTEMPTS is
   * reached it starts failing runs for real. The route reports a tick with a
   * non-zero count as FAILED — a silent defer is a worse bug than a loud
   * failure, because nobody finds out either way.
   */
  config_faults?: number
  /**
   * sms `send` actions that advanced via the unconfigured/env-missing path
   * (spec §4 amendment) rather than actually sending. Optional/undefined
   * until the first one happens — see `SmsAvailability` and its use in
   * `processRun`.
   */
  skipped_sms?: number
  /**
   * email `send` actions that advanced via the env-missing path (Task 1,
   * 2026-08-22-lead-engine-stage4-spine) rather than actually sending.
   * Optional/undefined until the first one happens — see
   * `EmailAvailability` and its use in `processRun`.
   */
  skipped_email?: number
  /** How many active businesses this tick iterated (Task 10). */
  businesses?: number
  /**
   * Task 10 (multi-coach ops): businesses whose preflight or claim loop
   * itself threw — isolated so one business's outage can't take the whole
   * tick down. Only present when non-empty. The route (app/api/admin/
   * internal/sequence-tick/route.ts) reads this to mark the ONE cron_runs
   * row for the tick `failed` and name the businesses, same reasoning as
   * `config_faults` above — see the design note on `runSequenceTick`.
   */
  failures?: Array<{ businessId: string; error: string }>
}

/**
 * The sms send path has two independent gates that must BOTH pass before
 * `processRun` will actually call Twilio:
 *
 *  - `smsConfigured(settings)` — has a human filled in `business_settings`
 *    for this business? (the DB-level switch, spec §4's original concern)
 *  - `smsEnvPresent()` — does THIS deployment actually have Twilio
 *    credentials set? (an env-level concern; see the doc comment on
 *    `smsEnvPresent` in lib/lead-engine/sms.ts)
 *
 * `configured` is the overall AND of both — whether `processRun` should
 * attempt a real send this tick. `reason` is the timeline reason to use on
 * the unconfigured path and is only meaningful when `configured` is false;
 * it distinguishes the two failure modes (`sms_not_configured` vs
 * `sms_env_missing`) so an operator reading the timeline can tell "nobody
 * has turned SMS on for this business" apart from "SMS is on, but this
 * deployment's Twilio keys are missing" — a live-day misconfiguration, not
 * a normal pre-launch state.
 */
type SmsAvailability = {
  configured: boolean
  reason: "sms_not_configured" | "sms_env_missing"
}

/**
 * The email send path's env-level gate, transplanting the SmsAvailability
 * pattern above (Task 1, 2026-08-22-lead-engine-stage4-spine). Unlike sms,
 * email has no separate per-business "has a human turned it on" DB switch to
 * check per run — `assertSendable` already covers that half, once per tick,
 * BEFORE any run is claimed (see the preflight comment in
 * `runSequenceTick`). So this is only the env-level concern:
 * `emailEnvPresent()` (lib/lead-engine/email.ts) — does THIS deployment
 * actually have a Resend API key? `configured: false` is always the
 * `email_env_missing` case; there is no `email_not_configured` sibling the
 * way sms has `sms_not_configured`, because a DB-unconfigured business never
 * reaches `processRun` at all.
 */
type EmailAvailability = {
  configured: boolean
}

const DEFAULT_LIMIT = 25
/**
 * How many consecutive failures a run gets before it is given up on.
 * `claim_sequence_runs` increments `attempts` on every claim and
 * `advanceRun`/`deferRun` reset it on any non-transient write-back
 * (lib/db/sequences.ts), so this counts consecutive failures, not lifetime
 * claims.
 */
const MAX_ATTEMPTS = 5

/**
 * The floor on a configuration fault's defer, and it is NOT a tuning knob.
 *
 * `recordSend` re-claims a crashed attempt only once the queued row is older
 * than `RECLAIM_WINDOW_MS` (15 minutes, lib/db/sequences.ts). A retry landing
 * inside that window finds its own row too young, gets `claimed: false`, and
 * burns the tick deferring on `send_in_progress` instead of retrying the send.
 * 20 > 15, with room for clock skew between this process and the database.
 */
const CONFIG_FAULT_MIN_DEFER_MS = 20 * 60 * 1000
const TRANSIENT_BACKOFF_BASE_MS = 5 * 60 * 1000
const TRANSIENT_BACKOFF_MAX_MS = 60 * 60 * 1000

/** 5m, 10m, 20m, 40m, capped at 1h. */
function transientBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(TRANSIENT_BACKOFF_BASE_MS * 2 ** exponent, TRANSIENT_BACKOFF_MAX_MS)
}
// Release window for the narrow recordSend race described below — short
// enough that a healthy retry lands within a tick or two, unrelated to
// recordSend's own 15-minute crashed-attempt reclaim window.
const SEND_RACE_RETRY_MS = 5 * 60 * 1000

// appOrigin() used to live here. It is now lib/lead-engine/origin.ts (see the
// import above), moved there so app/api/webhooks/twilio/status/route.ts
// (Task 4) — which needs the exact same origin to reconstruct and verify the
// URL Twilio signed its status callback against — can use it without pulling
// in this file's much larger, DB-heavy module graph. Re-exported here so
// every existing import of `appOrigin` from this module (notably
// __tests__/lib/automation/sequence-tick-origin.test.ts) keeps working
// unchanged.
export { appOrigin }

/**
 * Appends a `contact_timeline_events` row. Deliberately a raw
 * `createServiceRoleClient()` call rather than a `lib/db/` DAL function —
 * same accepted pattern as Task 6's
 * `lib/lead-engine/unsubscribe.ts` (`recordUnsubscribeTimelineEvent`),
 * chosen there because `lib/db/contacts.ts` has a queue of sequential
 * editors (Tasks 7/9/10) this file is not part of.
 *
 * Throws on failure rather than logging-and-continuing. Spec §6 is explicit
 * that an unsupported step or an alert must be "visible, not silent" — a
 * timeline write that silently drops on error would recreate exactly the
 * silence being fixed. The throw propagates out of `processRun` to
 * `runSequenceTick`'s fault-isolation catch, which defers the run for a retry
 * and only fails it once its attempts are exhausted (still exactly one
 * `sequence_runs` write-back — see the concurrency contract above).
 */
async function writeTimelineEvent(args: {
  businessId: string
  contactId: string
  kind: string
  metadata: Record<string, unknown>
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("contact_timeline_events").insert({
    business_id: args.businessId,
    contact_id: args.contactId,
    kind: args.kind,
    source: "sequence_engine",
    metadata: args.metadata,
  })
  if (error) throw error
}

/**
 * Executes exactly one `decideStep` outcome for one claimed run, ending in
 * exactly one call to a `sequence_runs` write-back function
 * (advanceRun/deferRun/exitRun/completeRun/failRun). See the concurrency
 * contract above — this function must never call more than one of those
 * per invocation, and must never call `decideStep` a second time for the
 * same run.
 */
async function processRun(
  run: SequenceRunRow,
  now: Date,
  businessId: string,
  settings: BusinessSettings,
  smsAvailability: SmsAvailability,
  emailAvailability: EmailAvailability,
  summary: TickSummary,
): Promise<void> {
  const steps = await loadSteps(run.sequence_id)
  const ctx = await loadRunContext(run, now, businessId)
  const action = decideStep(run, steps, ctx)

  switch (action.kind) {
    case "send": {
      if (action.channel === "sms") {
        if (!smsAvailability.configured) {
          // Either nobody has configured SMS for this business yet
          // (`reason: "sms_not_configured"`, the default state per
          // `lib/lead-engine/sms.ts`'s doc comment on `smsConfigured` —
          // migration 00221 seeds both columns `NOT NULL DEFAULT ''`), or SMS
          // IS configured in the DB but this deployment's Twilio credentials
          // are missing (`reason: "sms_env_missing"`, see `smsEnvPresent` —
          // a live-day misconfiguration, not a normal pre-launch state).
          // Either way, spec §6 groups an unsupported channel with
          // `tag`/`stage`: an unsupported kind records a
          // `sequence_step_unsupported` timeline event and ADVANCES, the
          // same "visible, not silent" shape this branch used before any SMS
          // sender existed at all — see the case-"advance" `unsupported_kind`
          // arm below for the sibling of this same rule.
          //
          // Spec §4 amendment (docs/superpowers/specs/2026-08-21-lead-engine-stage2-sms-design.md):
          // deliberately NOT a `recordSend` + immediate `skipped` message
          // row. `recordSend`'s `(run_id, step_id)` claim (lib/db/sequences.ts)
          // is PERMANENT — the first insert for that pair is the only one
          // that ever succeeds — so a row written here would block the real
          // send the day this business's Twilio credentials are set. The
          // timeline event alone satisfies "visible, not silent"; nothing
          // here pretends to have sent anything.
          await writeTimelineEvent({
            businessId,
            contactId: run.contact_id,
            kind: "sequence_step_unsupported",
            metadata: {
              run_id: run.id,
              sequence_id: run.sequence_id,
              step_id: action.step.id,
              step_kind: "sms",
              reason: smsAvailability.reason,
            },
          })
          await advanceRun(run.id, action.step.position + 1)
          summary.skipped_sms = (summary.skipped_sms ?? 0) + 1
          return
        }

        const to = ctx.contact.phone_e164
        if (!to) {
          // decideStep already guards this for the sms branch (it returns
          // "advance" with note "no_phone_number" when contact.phone_e164 is
          // null), so this should be unreachable — same rationale as the
          // email branch's `!to` guard just below. Fail loud instead of
          // calling the provider with an empty recipient.
          await failRun(run.id, "sms send action reached the runner, but the contact has no phone number")
          summary.failed += 1
          return
        }

        // Hoisted BEFORE recordSend claims (run_id, step_id) — same
        // placement as the email branch's `appOrigin()` call just below. If
        // the public-origin env is unset, appOrigin() throws HERE, before
        // anything is claimed, so the throw propagates out of processRun to
        // runSequenceTick's per-run catch and the run is DEFERRED for a
        // retry (self-healing once the env is fixed) rather than recordSend
        // permanently claiming the row and this branch immediately burning
        // it via markFailed/failRun. It used to be computed inline inside
        // the try below, AFTER the claim — that ordering meant the same
        // throw instead marked the message row (and the run) permanently
        // failed, with no way back in.
        const statusCallbackUrl = `${appOrigin()}/api/webhooks/twilio/status`

        // Rendered ONCE, here, before anything is claimed or sent — same
        // render-once-record-and-deliver-the-same-bytes reasoning as the
        // email branch below.
        const rendered = renderSequenceSms({
          body: action.step.body ?? "",
          contactName: ctx.contact.name,
        })

        const { claimed, messageId } = await recordSend({
          runId: run.id,
          stepId: action.step.id,
          contactId: run.contact_id,
          channel: "sms",
          toIdentifier: to,
          subject: null,
          bodyRendered: rendered.text,
          businessId,
        })

        if (!claimed) {
          // Same send-race rationale as the email branch's `!claimed` arm
          // below.
          await deferRun(run.id, new Date(now.getTime() + SEND_RACE_RETRY_MS), "send_in_progress")
          summary.deferred += 1
          return
        }

        // THE TRY COVERS THE PROVIDER CALL AND NOTHING ELSE — see the email
        // branch's identical comment below. A write-back failure after
        // Twilio has already accepted the message must never downgrade it to
        // failed.
        let providerMessageId: string | null = null
        try {
          ;({ providerMessageId } = await sendRenderedSequenceSms({
            to,
            text: rendered.text,
            settings,
            statusCallbackUrl,
          }))
        } catch (err) {
          // The provider itself rejected it: nothing was delivered, so the
          // message row is genuinely failed. Same idempotency rationale as
          // the email branch's catch below (recordSend will not re-claim a
          // 'failed' row, so a retry could never get past its own
          // idempotency gate and would defer on `send_in_progress` forever).
          const message = err instanceof Error ? err.message : String(err)
          await markFailed(messageId as string, message)
          await failRun(run.id, message)
          summary.failed += 1
          return
        }

        // Past this point the message is OUT — same reasoning as the email
        // branch below: nothing after this may relabel a delivered message
        // as failed.
        await markSent(messageId as string, "twilio", providerMessageId)
        await advanceRun(run.id, action.step.position + 1)
        summary.sent += 1
        return
      }

      if (!emailAvailability.configured) {
        // Same shape as the sms branch's `!smsAvailability.configured` arm
        // above, checked first for the same reason: spec §6 groups an
        // unsupported channel with `tag`/`stage`, so a due email step on a
        // deployment with no Resend key advances with a visible timeline
        // event instead of stalling the run.
        //
        // Deliberately NOT a `recordSend` + immediate `skipped` message
        // row — recordSend's (run_id, step_id) claim is PERMANENT, so a row
        // written here would block the real send the moment RESEND_API_KEY
        // is set. The timeline event alone satisfies "visible, not silent";
        // nothing here pretends to have sent anything.
        await writeTimelineEvent({
          businessId,
          contactId: run.contact_id,
          kind: "sequence_step_unsupported",
          metadata: {
            run_id: run.id,
            sequence_id: run.sequence_id,
            step_id: action.step.id,
            step_kind: "email",
            reason: "email_env_missing",
          },
        })
        await advanceRun(run.id, action.step.position + 1)
        summary.skipped_email = (summary.skipped_email ?? 0) + 1
        return
      }

      const to = ctx.contact.email
      if (!to) {
        // decideStep already guards this for the email branch (it returns
        // "advance" when contact.email is null), so this should be
        // unreachable. Fail loud instead of calling the provider with an
        // empty recipient.
        await failRun(run.id, "email send action reached the runner, but the contact has no email address")
        summary.failed += 1
        return
      }

      const origin = appOrigin()
      const unsubUrl = unsubscribeUrl(origin, run.contact_id, businessId)
      // The header URI must accept a POST (RFC 8058); the footer link is
      // followed by a browser. Two paths, one token, one flow.
      const oneClickUrl = unsubscribeOneClickUrl(origin, run.contact_id, businessId)
      // Minted for EVERY email step, not only the `sms_repermission` one:
      // `renderSequenceEmail` uses it solely where the stored body contains
      // `{{sms_consent_url}}`, and a body without the placeholder renders
      // identically whether this is passed or not. Deciding here which
      // sequences "should" get one would mean this runner had to know which
      // copy carries the placeholder — and the copy is explicitly meant to be
      // edited in the database, so it would be wrong the first time anyone
      // did. Signing a token costs one HMAC.
      const consentUrl = smsConsentUrl(origin, run.contact_id, businessId)

      // Rendered ONCE, here, before anything is claimed or sent. The same
      // bytes are then both recorded and delivered.
      //
      // recordSend used to be handed `action.step.subject` / `action.step.body`
      // — the raw template rows, before {{name}} substitution and before the
      // footer — so `body_rendered` stored what the sequence was configured to
      // say rather than what the person received. The seed copy is explicitly
      // meant to be edited, so the two drift the moment anyone does. The spec
      // requires `to_identifier` to record what was actually contacted;
      // `body_rendered` owes the same honesty.
      const rendered = renderSequenceEmail({
        settings,
        subject: action.step.subject ?? "",
        body: action.step.body ?? "",
        unsubscribeUrl: unsubUrl,
        smsConsentUrl: consentUrl,
        contactName: ctx.contact.name,
      })

      const { claimed, messageId } = await recordSend({
        runId: run.id,
        stepId: action.step.id,
        contactId: run.contact_id,
        channel: "email",
        toIdentifier: to,
        subject: rendered.subject,
        bodyRendered: rendered.text,
        businessId,
      })

      if (!claimed) {
        // recordSend's 15-minute crashed-attempt window and this run's
        // 10-minute stale-claim window don't line up: a run reclaimed
        // between 10 and 15 minutes after a crash can see its own message
        // row as "too young to reclaim" even though the prior attempt is
        // dead. Rather than hold this run's fresh claim for a full 10
        // minutes on the chance that's what happened, release it now via a
        // short defer so the next tick (or the one after) resolves it.
        await deferRun(run.id, new Date(now.getTime() + SEND_RACE_RETRY_MS), "send_in_progress")
        summary.deferred += 1
        return
      }

      // THE TRY COVERS THE PROVIDER CALL AND NOTHING ELSE. It used to span
      // markSent/advanceRun too, so a write-back failure called markFailed on
      // a message Resend had already accepted and delivered. That corrupts the
      // audit trail — the row says "failed" about an email sitting in
      // someone's inbox — and because loadRunContext's daily-cap query filters
      // `status='sent'`, it also lets another sequence send that same contact
      // a second message the same day. A failure AFTER the provider accepted
      // the message must never downgrade it.
      let providerMessageId: string | null = null
      try {
        ;({ providerMessageId } = await sendRenderedSequenceEmail({
          to,
          rendered,
          settings,
          unsubscribeUrl: unsubUrl,
          oneClickUrl,
        }))
      } catch (err) {
        // WHOSE FAULT IS THIS — the recipient's, or the configuration's?
        //
        // RECIPIENT is the case this catch was written for: the provider
        // rejected this address, nothing was delivered, and a retry would be
        // rejected identically. The message row is genuinely failed, and
        // failRun rather than a retry is deliberate — recordSend will not
        // re-claim a message row in status 'failed', so a retried run could
        // never get past its own idempotency gate and would defer on
        // `send_in_progress` forever.
        //
        // CONFIGURATION is the opposite case, and it used to be handled as if
        // it were this one. It fails every run in the batch identically and
        // self-heals the moment somebody fixes the setting — so nothing is
        // marked failed. The row is left `queued`, which is simply true
        // (nothing was delivered), and the throw is re-raised for
        // runSequenceTick's per-run catch to defer with the backoff that
        // already exists. recordSend's crashed-attempt path then re-claims the
        // row once RECLAIM_WINDOW_MS has passed, which is what
        // CONFIG_FAULT_MIN_DEFER_MS exists to guarantee.
        //
        // This is exactly what all 73 sms_repermission runs needed on
        // 2026-08-31 and did not get: one unverified sending domain marked
        // every one of them permanently failed inside ten minutes.
        if (classifySendFault(err) === "configuration") throw err

        const message = err instanceof Error ? err.message : String(err)
        await markFailed(messageId as string, message)
        await failRun(run.id, message)
        summary.failed += 1
        return
      }

      // Past this point the message is OUT. If either write below throws it
      // propagates to runSequenceTick's per-run catch, which defers the run
      // for a retry — the at-least-once contract documented on recordSend in
      // lib/db/sequences.ts. What must not happen, and no longer can, is the
      // delivered message being relabelled as failed.
      await markSent(messageId as string, "resend", providerMessageId)
      await advanceRun(run.id, action.step.position + 1)
      summary.sent += 1
      return
    }

    case "alert": {
      // Spec §6: alert notifies the BUSINESS, not the contact. The timeline
      // row is the required, unconditional "visible, not silent" signal —
      // written first, and its failure propagates (see writeTimelineEvent).
      await writeTimelineEvent({
        businessId,
        contactId: run.contact_id,
        kind: "sequence_alert",
        metadata: { run_id: run.id, sequence_id: run.sequence_id, step_id: action.step.id },
      })

      // The email half reuses sendSequenceEmail, sent to
      // business_settings.reply_to, with `includeUnsubscribeFooter: false`.
      //
      // That flag is not cosmetic. This mail goes to the OPERATOR, but the
      // only unsubscribe token this code could mint is one for the LEAD the
      // alert concerns. The unsubscribe page writes on GET, and corporate
      // mail scanners (Safe Links, Mimecast, Barracuda) GET every URL in an
      // inbound message — so a scanner in the operator's own inbox would
      // silently suppress that lead, exit their runs, and write a
      // granted:false consent row attributing the revocation to
      // `unsubscribe_link`. That is a falsified record in the one table whose
      // entire purpose is defensible consent, and nothing downstream could
      // tell it apart from a real revocation.
      //
      // So no token is minted here at all: there is no URL for a scanner to
      // follow, and no List-Unsubscribe header either. An internal ops
      // notification is not a commercial message and CAN-SPAM's footer
      // requirements do not attach to it.
      //
      // A failed alert EMAIL is logged, not fatal: the timeline row above
      // already satisfies "visible", and this lead's own sequence
      // progression must not stall on a Resend hiccup for a side-channel
      // notification to someone else.
      try {
        await sendSequenceEmail({
          to: settings.reply_to,
          subject: action.step.subject ?? "Sequence alert",
          body: action.step.body ?? "",
          contactName: null,
          settings,
          includeUnsubscribeFooter: false,
        })
      } catch (err) {
        console.error(`[sequence-tick] alert email to reply_to failed for run ${run.id}:`, err)
      }

      await advanceRun(run.id, action.step.position + 1)
      return
    }

    case "advance": {
      // Spec §6: an unsupported step kind (`tag`/`stage` today) must be
      // visible, not silently skipped. decideStep already signals this via
      // `note === "unsupported_kind"` — look up the step it was evaluating
      // (by the run's CURRENT position, before this advance) purely to
      // attach its id/kind to the timeline row.
      if (action.note === "unsupported_kind") {
        const unsupportedStep = steps.find((s) => s.position === run.current_position)
        await writeTimelineEvent({
          businessId,
          contactId: run.contact_id,
          kind: "sequence_step_unsupported",
          metadata: {
            run_id: run.id,
            sequence_id: run.sequence_id,
            step_id: unsupportedStep?.id ?? null,
            step_kind: unsupportedStep?.kind ?? null,
          },
        })
      }
      await advanceRun(run.id, action.toPosition, action.deferUntil)
      return
    }

    case "defer":
      await deferRun(run.id, action.until, action.reason)
      summary.deferred += 1
      return

    case "exit":
      await exitRun(run.id, action.reason)
      summary.exited += 1
      return

    case "complete":
      await completeRun(run.id)
      summary.completed += 1
      return

    case "fail":
      await failRun(run.id, action.error)
      summary.failed += 1
      return
  }
}

/**
 * Claims up to `limit` due runs for ONE business and processes each one to
 * exactly one write-back (see the concurrency contract above). A run that
 * throws anywhere in `processRun` — a bad DB read, an unexpected exception —
 * is caught HERE and the batch continues. One poisoned run must never stop
 * every other contact's sequence.
 *
 * A caught throw is RETRIED, not buried. `status='failed'` is terminal —
 * nothing in this codebase re-activates a failed run — and `loadRunContext`
 * performs five reads that throw by design on failure (correctly: a failed
 * consent read is not "no consent"). Treating every throw as terminal meant
 * one Supabase blip during a 25-run tick permanently killed all 25. So the run
 * is deferred with a backoff while it has attempts left, and only failed once
 * it has burned through them — at which point it really is poison and a human
 * should look at it.
 *
 * `limit` (fix round 1) is what's LEFT of the whole tick's budget, not a
 * fresh per-business allowance — see `runSequenceTick`'s doc comment. A
 * `limit` of 0 must claim nothing: `claim_sequence_runs`'s own `LIMIT 0`
 * would already return zero rows, but the guard below makes that explicit
 * rather than relying on the RPC's SQL semantics, and skips the round trip
 * entirely once the tick's budget is spent.
 *
 * Mutates `summary` in place — counts accumulate across every business
 * `runSequenceTick` iterates, not just this one.
 */
async function runSequenceTickForBusiness(
  businessId: string,
  now: Date,
  limit: number,
  summary: TickSummary,
): Promise<void> {
  if (limit <= 0) return
  const claimToken = randomUUID()

  // PREFLIGHT BEFORE ANY CLAIM. Migration 00212 seeds every identity column
  // as NOT NULL DEFAULT '' and nothing calls updateBusinessSettings, so an
  // untouched install would send `from: " <>"`, be rejected by Resend, and
  // land in processRun's catch — permanently failing every claimed run with
  // no admin surface and no re-activation path. assertSendable throws
  // BusinessNotConfiguredError, which propagates out of this function to
  // `runSequenceTick`'s per-business catch (see below). Nothing is claimed
  // for THIS business, so nothing can be failed for it — but other
  // businesses in the same tick still run.
  //
  // Settings are also loaded once per tick rather than once per run —
  // lib/lead-engine/email.ts's sendSequenceEmail explicitly supports being
  // handed them to avoid a redundant read. `smsConfigured` is computed from
  // that same read for the same reason: it is pure and settings do not
  // change mid-tick, so there is no reason for every sms run in the batch to
  // recompute it (or, worse, re-read business_settings itself). `smsEnvPresent`
  // is a second, independent gate — see `SmsAvailability`'s doc comment —
  // also computed once per tick since env vars don't change mid-tick either.
  // `emailEnvPresent` (Task 1, 2026-08-22-lead-engine-stage4-spine) is the
  // same env-level gate for email — see `EmailAvailability`'s doc comment
  // for why it has no DB-configured half to AND against, unlike sms.
  const settings = await getBusinessSettings(businessId)
  assertSendable(settings)
  const smsDbConfigured = smsConfigured(settings)
  const smsAvailability: SmsAvailability = {
    configured: smsDbConfigured && smsEnvPresent(),
    reason: smsDbConfigured ? "sms_env_missing" : "sms_not_configured",
  }
  const emailAvailability: EmailAvailability = { configured: emailEnvPresent() }

  const runs = await claimDueRuns(limit, claimToken, businessId)
  summary.claimed += runs.length
  if (runs.length === 0) return

  for (const run of runs) {
    try {
      await processRun(run, now, businessId, settings, smsAvailability, emailAvailability, summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const attempts = run.attempts ?? 0
      const retryable = attempts < MAX_ATTEMPTS
      console.error(
        `[sequence-tick] run ${run.id} threw on attempt ${attempts}, ${retryable ? "deferring" : "failing"}:`,
        message,
      )
      try {
        if (retryable) {
          // A configuration fault waits out recordSend's reclaim window, so
          // the retry can actually re-claim its own queued row rather than
          // bouncing on `send_in_progress`. Everything else keeps the
          // existing backoff untouched.
          const isConfigFault = err instanceof SequenceSendError && classifySendFault(err) === "configuration"
          const backoffMs = isConfigFault
            ? Math.max(transientBackoffMs(attempts), CONFIG_FAULT_MIN_DEFER_MS)
            : transientBackoffMs(attempts)
          await deferRun(run.id, new Date(now.getTime() + backoffMs), TRANSIENT_ERROR_DEFER_REASON)
          summary.deferred += 1
          if (isConfigFault) summary.config_faults = (summary.config_faults ?? 0) + 1
        } else {
          await failRun(run.id, message)
          summary.failed += 1
        }
      } catch (writeErr) {
        // The write-back itself failed, so this run keeps its claim and will
        // be re-claimed by the stale-claim arm in ~10 minutes. Nothing else
        // to do here except not take the batch down with it.
        console.error(`[sequence-tick] write-back after a throw also failed for run ${run.id}:`, writeErr)
        summary.failed += 1
      }
    }
  }
}

/**
 * Task 10 (multi-coach ops): loops `runSequenceTickForBusiness` over every
 * active business, but still returns ONE `TickSummary` for the whole tick —
 * the route (app/api/admin/internal/sequence-tick/route.ts) writes exactly
 * ONE `cron_runs` row per call to this function, same reasoning as
 * `lib/automation/pipeline-reconcile.ts`'s `runPipelineReconcile`:
 * `lastSuccessPerCron` (lib/db/cron-runs.ts) reads the single most recent
 * SUCCESSFUL row per cron_name, so a row per business would let one
 * succeeding business mask another failing every tick.
 *
 * `limit` (fix round 1) is a TICK-WIDE budget, not a per-business one. It
 * used to be handed unchanged to every business's `claimDueRuns`, so a
 * 2-business tick could claim 2x `DEFAULT_LIMIT` (25) runs against this
 * route's `maxDuration: 120` — silently changing what the cap means the
 * moment a second business existed. `remaining` is decremented by however
 * many a business actually claimed (not the limit it was offered), so a
 * business claiming fewer than its share leaves the rest for whoever comes
 * next in the loop, and the running total across the whole tick can never
 * exceed `limit`.
 *
 * One business's preflight/claim/processing throwing must not stop the
 * others — each is wrapped in its own try/catch and recorded in
 * `failures[]` rather than rethrown immediately.
 *
 * EXCEPTION, deliberately: if EVERY active business failed (not just one of
 * several), the ORIGINAL error is rethrown rather than swallowed into a
 * "successful" summary. With today's single active business this makes an
 * unconfigured-business preflight failure propagate to the route exactly as
 * it did before this task — same `BusinessNotConfiguredError` instance, same
 * `instanceof` check, same 200-with-`{error}` response — which is the
 * behavioural no-op that makes this safe to land before any second business
 * exists. It also means "all businesses failed" is never quietly reported as
 * a tick that "succeeded" with zero of everything.
 *
 * `failures` (fix round 1) rides along on the rethrown error itself — as a
 * plain extra property, so `instanceof BusinessNotConfiguredError` at the
 * route still works unchanged — so the route's cron_runs detail can still
 * name EVERY business that failed even on the all-failed path, not just
 * whichever one happened to be last in iteration order and get rethrown.
 */
export async function runSequenceTick(opts?: { limit?: number; now?: Date }): Promise<TickSummary> {
  const now = opts?.now ?? new Date()
  const tickLimit = opts?.limit ?? DEFAULT_LIMIT

  const businesses = await listBusinesses({ activeOnly: true })
  if (businesses.length === 0) {
    throw new Error("[sequence-tick] no active businesses found")
  }

  const summary: TickSummary = { claimed: 0, sent: 0, deferred: 0, exited: 0, completed: 0, failed: 0 }
  const failures: Array<{ businessId: string; error: string }> = []
  let lastError: unknown = null
  let remaining = tickLimit

  for (const business of businesses) {
    try {
      const claimedBefore = summary.claimed
      await runSequenceTickForBusiness(business.id, now, remaining, summary)
      remaining -= summary.claimed - claimedBefore
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ businessId: business.id, error: message })
      lastError = err
      console.error(`[sequence-tick] business ${business.id} failed:`, message)
    }
  }

  if (failures.length > 0 && failures.length === businesses.length) {
    if (lastError && typeof lastError === "object") {
      Object.assign(lastError as object, { failures })
    }
    throw lastError
  }

  summary.businesses = businesses.length
  if (failures.length > 0) summary.failures = failures
  return summary
}
