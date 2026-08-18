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
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"
import { sendSequenceEmail } from "@/lib/lead-engine/email"
import { unsubscribeUrl } from "@/lib/lead-engine/unsubscribe-token"
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

function appOrigin(): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null
  if (explicit) return explicit.replace(/\/+$/, "")
  return "http://localhost:3050"
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

      const unsubUrl = unsubscribeUrl(appOrigin(), run.contact_id, businessId)

      try {
        const { providerMessageId } = await sendSequenceEmail({
          to,
          subject: action.step.subject ?? "",
          body: action.step.body ?? "",
          unsubscribeUrl: unsubUrl,
          // Stage 1b does not thread the contact's name through to the
          // runner (loadRunContext's DecisionContext carries only what
          // decideStep needs). {{name}} falls back to "" per
          // lib/lead-engine/email.ts — safe, just unpersonalized. Follow-up:
          // wire a name read through if this matters before Stage 2.
          contactName: null,
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

    case "alert":
      // Spec §6: alert notifies the business (email to reply_to + a
      // timeline event), not the contact. That notification channel isn't
      // wired yet — no Stage 1b seed sequence uses `alert` and Task 3 left
      // it untested by design (progress.md). Advance past it so the run
      // never stalls waiting on a side effect that doesn't exist; revisit
      // once a real alert channel ships.
      await advanceRun(run.id, action.step.position + 1)
      return

    case "advance":
      await advanceRun(run.id, action.toPosition, action.deferUntil)
      return

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

  const runs = await claimDueRuns(limit, claimToken, businessId)
  summary.claimed = runs.length
  if (runs.length === 0) return summary

  // Loaded once per tick, not once per run — lib/lead-engine/email.ts's
  // sendSequenceEmail explicitly supports this to avoid a redundant read.
  const settings = await getBusinessSettings(businessId)

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
