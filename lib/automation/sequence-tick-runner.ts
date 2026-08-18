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
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"
import { assertSendable, sendSequenceEmail } from "@/lib/lead-engine/email"
import { unsubscribeUrl, unsubscribeOneClickUrl } from "@/lib/lead-engine/unsubscribe-token"
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
}

const DEFAULT_LIMIT = 25
// Release window for the narrow recordSend race described below — short
// enough that a healthy retry lands within a tick or two, unrelated to
// recordSend's own 15-minute crashed-attempt reclaim window.
const SEND_RACE_RETRY_MS = 5 * 60 * 1000

/**
 * The public origin every unsubscribe link and every List-Unsubscribe header
 * in this engine's outbound mail is built from.
 *
 * The chain is NEXTAUTH_URL -> NEXT_PUBLIC_APP_URL -> APP_URL, matching every
 * other email-link builder in this repo (lib/url.ts, lib/email.ts,
 * lib/shop/emails.ts, lib/messaging/email-new-message.ts). It used to read
 * `APP_URL ?? NEXT_PUBLIC_SITE_URL` with a localhost fallback, and both of
 * those reads miss in the runtime this code executes in: .env.example:124
 * states plainly that "Next.js server-side code reads NEXTAUTH_URL; APP_URL is
 * Firebase-side only", and NEXT_PUBLIC_SITE_URL is declared nowhere at all.
 * So every unsubscribe link shipped pointing at http://localhost:3050.
 *
 * THROWS rather than defaulting. A path that mints links for mail leaving the
 * building must fail loudly when it does not know where it lives — a silent
 * localhost default produces a dead unsubscribe link in a real inbox, which is
 * both a CAN-SPAM problem and invisible until someone complains.
 *
 * Exported for __tests__/lib/automation/sequence-tick-origin.test.ts.
 */
export function appOrigin(): string {
  const candidates = [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL]
  // Trimmed-emptiness, not `??`: an env var set to "" is configured-as-blank,
  // and passing it through would mint a relative "/unsubscribe/<token>" URL
  // that resolves against the recipient's mail client, not against this app.
  const explicit = candidates.find((value) => typeof value === "string" && value.trim().length > 0)
  if (!explicit) {
    throw new Error(
      "no public origin configured: set NEXTAUTH_URL (or NEXT_PUBLIC_APP_URL / APP_URL). " +
        "Refusing to mint unsubscribe links for outbound mail against a localhost default.",
    )
  }
  return explicit.trim().replace(/\/+$/, "")
}

/**
 * Appends a `contact_timeline_events` row. Deliberately a raw
 * `createServiceRoleClient()` call rather than a `lib/db/` DAL function —
 * same accepted pattern as Task 6's
 * `app/(marketing)/unsubscribe/[token]/page.tsx` (`recordUnsubscribeTimelineEvent`),
 * chosen there because `lib/db/contacts.ts` has a queue of sequential
 * editors (Tasks 7/9/10) this file is not part of.
 *
 * Throws on failure rather than logging-and-continuing. Spec §6 is explicit
 * that an unsupported step or an alert must be "visible, not silent" — a
 * timeline write that silently drops on error would recreate exactly the
 * silence being fixed. The throw propagates out of `processRun` to
 * `runSequenceTick`'s fault-isolation catch, which marks the run `failed`
 * (still exactly one `sequence_runs` write-back — see the concurrency
 * contract above).
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
  summary: TickSummary,
): Promise<void> {
  const steps = await loadSteps(run.sequence_id)
  const ctx = await loadRunContext(run, now, businessId)
  const action = decideStep(run, steps, ctx)

  switch (action.kind) {
    case "send": {
      if (action.channel === "sms") {
        // No Stage 1b sequence sends SMS (CONTEXT.md's consent regime — SMS
        // is opt-in and no consent rows exist today) and there is no SMS
        // sender wired in this codebase yet. Fail loud rather than pretend
        // to send, or crash with an unhandled "not a function".
        await failRun(run.id, "sms send action reached the runner, but Stage 1b has no SMS sender wired in")
        summary.failed += 1
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

      const { claimed, messageId } = await recordSend({
        runId: run.id,
        stepId: action.step.id,
        contactId: run.contact_id,
        channel: "email",
        toIdentifier: to,
        subject: action.step.subject,
        bodyRendered: action.step.body ?? "",
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

      const origin = appOrigin()
      const unsubUrl = unsubscribeUrl(origin, run.contact_id, businessId)
      // The header URI must accept a POST (RFC 8058); the footer link is
      // followed by a browser. Two paths, one token, one flow.
      const oneClickUrl = unsubscribeOneClickUrl(origin, run.contact_id, businessId)

      try {
        const { providerMessageId } = await sendSequenceEmail({
          to,
          subject: action.step.subject ?? "",
          body: action.step.body ?? "",
          unsubscribeUrl: unsubUrl,
          oneClickUrl,
          contactName: ctx.contact.name,
          settings,
        })
        await markSent(messageId as string, "resend", providerMessageId)
        await advanceRun(run.id, action.step.position + 1)
        summary.sent += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await markFailed(messageId as string, message)
        await failRun(run.id, message)
        summary.failed += 1
      }
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
 * Claims up to `limit` due runs and processes each one to exactly one
 * write-back (see the concurrency contract above). A run that throws
 * anywhere in `processRun` — a bad DB read, an unexpected exception — is
 * caught HERE, marked failed via `failRun`, and the batch continues. One
 * poisoned run must never stop every other contact's sequence.
 */
export async function runSequenceTick(opts?: { limit?: number; now?: Date }): Promise<TickSummary> {
  const now = opts?.now ?? new Date()
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const businessId = SINGLETON_BUSINESS_ID
  const claimToken = randomUUID()

  const summary: TickSummary = { claimed: 0, sent: 0, deferred: 0, exited: 0, completed: 0, failed: 0 }

  // PREFLIGHT BEFORE ANY CLAIM. Migration 00212 seeds every identity column
  // as NOT NULL DEFAULT '' and nothing calls updateBusinessSettings, so an
  // untouched install would send `from: " <>"`, be rejected by Resend, and
  // land in processRun's catch — permanently failing every claimed run with
  // no admin surface and no re-activation path. assertSendable throws
  // BusinessNotConfiguredError, which the route answers with a 200 (see
  // app/api/admin/internal/sequence-tick/route.ts). Nothing is claimed, so
  // nothing can be failed.
  //
  // Settings are also loaded once per tick rather than once per run —
  // lib/lead-engine/email.ts's sendSequenceEmail explicitly supports being
  // handed them to avoid a redundant read.
  const settings = await getBusinessSettings(businessId)
  assertSendable(settings)

  const runs = await claimDueRuns(limit, claimToken, businessId)
  summary.claimed = runs.length
  if (runs.length === 0) return summary

  for (const run of runs) {
    try {
      await processRun(run, now, businessId, settings, summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sequence-tick] run ${run.id} threw, isolating:`, message)
      try {
        await failRun(run.id, message)
      } catch (failErr) {
        console.error(`[sequence-tick] failRun also failed for run ${run.id}:`, failErr)
      }
      summary.failed += 1
    }
  }

  return summary
}
