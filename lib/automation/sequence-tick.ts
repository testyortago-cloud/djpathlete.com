// Pure decision core for the Lead Engine sequence tick.
//
// This module must import nothing except pure helpers from
// `lib/lead-engine/guardrails.ts` (and pure type imports) — no
// `@/lib/supabase`, no DAL, no I/O of any kind. That purity is what lets its
// tests run with zero mocks. A later task (`lib/automation/sequence-tick-runner.ts`)
// wraps this in database IO; do not add any of that here.

import { quietHoursDefer, dailyCapDefer, siblingRunDefer } from "@/lib/lead-engine/guardrails"
import type { QuietHours } from "@/lib/lead-engine/guardrails"
import { parseTagConfig, parseStageConfig, parseWaitConfig } from "@/lib/lead-engine/step-config"
import type { EnrolmentMetadata, EnrolmentMetadataKey } from "@/lib/lead-engine/enrolment-metadata"

export type StepKind = "email" | "sms" | "wait" | "branch" | "tag" | "stage" | "alert" | "stop"

export type BranchCondition =
  | { kind: "has_phone" }
  | { kind: "has_user" }
  | { kind: "has_consent"; channel: "email" | "sms" }
  | { kind: "source_is"; value: string }
  /**
   * G09. Engagement with the most recent email THIS RUN sent.
   *
   * `opened_last_email` is the predicate the quotation names, and it is
   * the weaker of the two by a long way: an open is a 1x1 tracking pixel,
   * Apple Mail Privacy Protection pre-fetches it on every message whether
   * or not a human looks, and Gmail proxies images. On a consumer list
   * that is typically half the recipients, so this predicate OVER-COUNTS
   * and always will. It does not error and it is not "broken" — it is
   * just measuring something softer than it sounds.
   *
   * `clicked_last_email` has no such problem: a click is a real action on
   * a real link. Prefer it wherever the branch actually matters.
   */
  | { kind: "opened_last_email" }
  | { kind: "clicked_last_email" }
  /**
   * G10. A fact about the EVENT that enrolled this run, as opposed to
   * `source_is`, which reads the sequence's own trigger and is therefore the
   * same value for everybody in that sequence.
   *
   * This is what makes coaching-vs-camp and parent-vs-adult answerable:
   * `{key:"service", value:"camp"}`, `{key:"role", value:"parent"}`,
   * `{key:"event_kind", value:"clinic"}`. `key` is restricted to
   * `ENROLMENT_METADATA_KEYS` because those are the only keys anything
   * writes — a free-form key would let a coach build a branch that is false
   * forever with nothing to tell them why.
   */
  | { kind: "enrolled_metadata_is"; key: EnrolmentMetadataKey; value: string }

export type SequenceStepRow = {
  id: string
  position: number
  kind: StepKind
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: BranchCondition | null
  on_true_position: number | null
  on_false_position: number | null
  config: Record<string, unknown>
}

export type SequenceRunRow = {
  id: string
  sequence_id: string
  contact_id: string
  current_position: number
  enrolled_at: string
  /**
   * Incremented by `claim_sequence_runs` (migration 00217) on every claim, so
   * a freshly claimed run is always on attempt 1 or higher. Reset to 0 by any
   * write-back that is not a transient-error defer, which makes it a count of
   * CONSECUTIVE failures rather than a lifetime claim counter — see
   * `deferRun` / `advanceRun` in lib/db/sequences.ts. `decideStep` does not
   * read it; the runner uses it to decide retry vs. give up.
   */
  attempts: number
  /**
   * G10, migration 00266. The allow-listed facts about the event that
   * enrolled this run, written once by `insertSequenceRun`
   * (lib/lead-engine/enroll.ts) and never updated afterwards.
   *
   * OPTIONAL IN THE TYPE, not in the database: `claim_sequence_runs` is
   * `RETURNS SETOF public.sequence_runs ... RETURNING r.*`, so it picks the
   * column up with no function change — but for the one deploy where the
   * Vercel build is live and the migration is not, the key is simply absent
   * from the row. `loadRunContext` therefore reads it as `?? {}`, never
   * against null: an absent key is `undefined`, and `undefined !== null`.
   */
  enrolment_metadata?: EnrolmentMetadata | null
  /**
   * G11, migration 00267. The fixed moment this run's countdown hangs off,
   * written once by `insertSequenceRun` and never updated — a camp whose date
   * moves does NOT silently re-time a countdown that is already part-way
   * sent. Re-anchoring is a decision somebody makes, not a side effect.
   *
   * OPTIONAL IN THE TYPE for the same one-deploy reason as
   * `enrolment_metadata` above, and read by `loadRunContext` as `?? null`
   * rather than tested against null, because an absent key is `undefined`.
   *
   * NULL IS THE NORMAL CASE. Almost no run is anchored to anything; only the
   * two event routes supply one.
   */
  anchor_at?: string | null
}

export type DecisionContext = {
  now: Date
  timezone: string
  quiet: QuietHours
  dailyCap: number
  sentAtToday: Array<string | Date>
  activeSiblings: Array<{ id: string; enrolled_at: string }>
  contact: { email: string | null; phone_e164: string | null; user_id: string | null; name: string | null }
  hasEmailConsent: boolean
  hasSmsConsent: boolean
  isSuppressed: boolean
  enrolledSource: string | null
  /**
   * The most recent email THIS run sent, and what Resend has since said
   * about it (G09). `null` when the run has sent no email yet — which the
   * engagement predicates read as false rather than as an error.
   */
  lastEmail: { openedAt: string | null; clickedAt: string | null } | null
  /**
   * G10. What the run remembers about the event that enrolled it — the
   * allow-listed subset written at enrolment, read by
   * `enrolled_metadata_is`. Always an object: `{}` both for a run that
   * carried no such fact and for one enrolled before migration 00266, which
   * are the same answer to a branch.
   */
  enrolmentMetadata: EnrolmentMetadata
  /**
   * G11. The fixed moment this run's countdown hangs off —
   * `sequence_runs.anchor_at`, which is `events.start_date` for an
   * `event_signup` enrolment. `null` for the overwhelming majority of runs,
   * which are not anchored to anything.
   *
   * Read ONLY by the `wait` case, and only when that step carries a
   * `wait_until` config. A null anchor meeting an anchored wait EXITS the run
   * with `not_anchored` rather than sending — exited and not completed, so
   * the re-enrolment cooldown can forgive it. See `decideStep`.
   */
  anchorAt: string | null
}

export type StepAction =
  | { kind: "send"; step: SequenceStepRow; channel: "email" | "sms" }
  | { kind: "alert"; step: SequenceStepRow }
  | { kind: "tag"; step: SequenceStepRow; tag: string }
  | { kind: "stage"; step: SequenceStepRow; pipelineKey: string | null; stageKey: string }
  | { kind: "advance"; toPosition: number; deferUntil?: Date; note?: string }
  | { kind: "defer"; until: Date; reason: string }
  | { kind: "exit"; reason: string }
  | { kind: "complete" }
  | { kind: "fail"; error: string }

export function evaluateBranch(
  condition: BranchCondition,
  ctx: DecisionContext,
): { ok: true; value: boolean } | { ok: false; error: string } {
  switch (condition.kind) {
    case "has_phone":
      return { ok: true, value: ctx.contact.phone_e164 !== null }
    case "has_user":
      return { ok: true, value: ctx.contact.user_id !== null }
    case "has_consent":
      return {
        ok: true,
        value: condition.channel === "email" ? ctx.hasEmailConsent : ctx.hasSmsConsent,
      }
    case "source_is":
      return { ok: true, value: ctx.enrolledSource === condition.value }
    case "opened_last_email":
      // No email sent yet reads as false, not as an error: the person has
      // not opened something that was never sent, and failing the run
      // would punish an editor for an odd but legal step order.
      return { ok: true, value: ctx.lastEmail?.openedAt != null }
    case "clicked_last_email":
      return { ok: true, value: ctx.lastEmail?.clickedAt != null }
    case "enrolled_metadata_is": {
      // A key the run does not carry is FALSE, not an error: every run
      // enrolled before migration 00266 carries `{}`, and a front door with
      // no such fact to offer is normal rather than broken. Failing here
      // would kill those runs the moment a coach added this branch.
      const remembered = ctx.enrolmentMetadata[condition.key]
      if (typeof remembered !== "string") return { ok: true, value: false }
      // Case- and space-insensitive. The stored side is mostly machine-written
      // (`camp`, `parent`, `in_person`), but `camp_name` is an owner's title
      // and `sport` (G16) is what an applicant typed; the compared side is
      // typed by a coach into a text box, and a branch that silently never
      // matches because of a capital letter is the worst way to learn that.
      // Only the ends are trimmed: "Track  and Field" with two spaces inside
      // does not match "track and field".
      //
      // NO SEPARATE "the coach left the box blank" CHECK. One was written
      // here and removed: it could never change an answer, because a blank
      // one is already false — `pickEnrolmentMetadata` never stores an empty
      // or blank value, so nothing a run remembers can equal "". The two
      // places that DO refuse a blank answer are `branchConditionIsKnown`
      // (lib/lead-engine/step-list.ts) and `branchConditionSchema`
      // (lib/validators/sequence-admin.ts), which stop it being saved at
      // all. A third copy here was unreachable code shaped like a guard,
      // which is how two guards end up masking each other.
      const typed = condition.value.trim().toLowerCase()
      return { ok: true, value: remembered.trim().toLowerCase() === typed }
    }
    default:
      // An unknown predicate must FAIL the run, never default to a boolean —
      // guessing which branch arm is correct can send the wrong message to a
      // real person. A failed run is visible and recoverable; a wrong guess
      // is not.
      return { ok: false, error: `unknown branch condition: ${(condition as { kind: string }).kind}` }
  }
}

/**
 * G11. The instant `days` before `anchorAt`.
 *
 * Plain milliseconds, NOT a calendar-day subtraction, and the difference
 * matters across a daylight-saving boundary: a reminder promised as "3 days
 * before" should be 72 hours before, not 71 or 73. The send is then held to
 * the contact's waking hours by `quietHoursDefer`, which is where local time
 * is supposed to be reasoned about — doing it here as well would apply the
 * timezone twice.
 */
function anchorMoment(anchorAt: string, days: number): Date {
  return new Date(new Date(anchorAt).getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * The step kinds that END a passed moment's block, as opposed to belonging to
 * it. A `Record` over the union, so a new step kind is a compile error here
 * rather than a silent decision about whether stale reminders reach people.
 *
 * Only a `wait` and a `stop` qualify, and for different reasons. A WAIT is the
 * only thing that establishes a new timing moment — everything between two
 * waits happens at one moment, so if that moment has gone, all of it has gone.
 * A STOP is a deliberate terminator and must never be walked past.
 *
 * EVERYTHING ELSE BELONGS TO THE BLOCK, including `tag`, `stage`, `alert` and
 * `branch`. An earlier cut stopped at the first non-MESSAGE step, reasoning
 * that bookkeeping should still run. That was wrong, and the shape that broke
 * it is ordinary: `wait(-14) / tag / email`. The scan ended at the tag, the
 * runner applied it and advanced, and the next tick sent "Two weeks to go"
 * five days before the camp. Keeping a moment's bookkeeping while dropping
 * its message is not a coherent half either — the tag would say "we reminded
 * them", and we did not.
 */
const ENDS_A_PASSED_BLOCK: Record<StepKind, boolean> = {
  wait: true,
  stop: true,
  email: false,
  sms: false,
  branch: false,
  tag: false,
  stage: false,
  alert: false,
}

/**
 * G11. Where a run resumes when an anchored moment has already passed.
 *
 * THE RULE, in one sentence: a WAIT is the only thing that establishes a
 * timing moment, so everything from a passed wait up to the next wait belongs
 * to that moment and goes with it.
 *
 * Concretely, walking forward from the passed wait:
 *   - a message, `tag`, `stage`, `alert` or `branch` belongs to the moment
 *     that gated it → skip it;
 *   - another ANCHORED wait that has ALSO passed → skip it, and its whole
 *     block with it;
 *   - another ANCHORED wait still AHEAD → stop there, that is the next true
 *     reminder;
 *   - an ORDINARY `wait_minutes` → stop there. It starts a new relative
 *     moment, so a post-event follow-up ("how did it go?") still reaches
 *     somebody who signed up too late for the countdown;
 *   - a `stop` → stop there; it is a deliberate terminator.
 *
 * WHY BOOKKEEPING GOES WITH THE MESSAGE, which an earlier cut got wrong. That
 * version stopped at the first non-MESSAGE step so that a `tag` between two
 * reminders would still run. The shape `wait(-14) / tag / email` then defeated
 * the skip completely: the scan ended at the tag, the runner applied it and
 * advanced one position, and the next tick sent "Two weeks to go" five days
 * before the camp. Keeping a moment's bookkeeping while dropping its message
 * is not a coherent half anyway — the tag would record that we reminded
 * somebody we did not remind.
 *
 * Running off the end of the list COMPLETES the run: every remaining
 * reminder's moment is in the past, and there is no honest message left.
 *
 * TWO KNOWN BOUNDARIES, recorded rather than fixed.
 *
 * 1. AN ANCHORED WAIT GATES ONLY WHAT FOLLOWS IT IN POSITION ORDER. A
 *    `branch` whose `on_true_position` / `on_false_position` points past one
 *    jumps straight to that step, and a message reached that way sends
 *    whatever the anchor says — the timing check never runs, because the run
 *    never arrived at the wait. Not reachable in the product today
 *    (`camp_clinic_deadline` has no branch step). Closing it would mean
 *    teaching every message step which moment gates it, which the step list
 *    does not express.
 *
 * 2. THE ANCHOR IS CONSULTED ONCE, HERE — NEVER AGAIN AT THE SEND. This arm
 *    advances past the wait and sets `next_run_at` to the target, after which
 *    nothing re-reads `anchor_at`; `case "email"` has no anchor logic. So any
 *    guardrail that delays the SEND shifts it off the promised moment:
 *    `quietHoursDefer` by hours, `dailyCapDefer` to the next local day, and
 *    `siblingRunDefer` — which returns `now + 5 minutes` UNBOUNDED for as
 *    long as an older active run exists — by arbitrarily long. Concretely: a
 *    contact manually enrolled in `sms_repermission` (manual-only sequences
 *    are exempt from G14 in both directions) who then registers camp interest
 *    20 days out can receive "Two weeks to go" two days before the camp. The
 *    00269 header's "each one true" holds for a run that is not delayed after
 *    its wait resolves; this is the case where it does not. Fixing it needs a
 *    per-send deadline, which this step list cannot currently carry.
 *
 * A malformed `wait_until` on a LATER step is treated as "not an anchored
 * wait still ahead", so the scan stops on it and the ordinary decision path
 * reports the fault next tick with its own sentence. This function never
 * reports somebody else's parse error.
 */
function skipPastAnchoredMoment(from: SequenceStepRow, steps: SequenceStepRow[], ctx: DecisionContext): StepAction {
  const later = steps.filter((s) => s.position > from.position).sort((a, b) => a.position - b.position)

  for (const candidate of later) {
    if (!ENDS_A_PASSED_BLOCK[candidate.kind]) continue

    if (candidate.kind === "wait") {
      const parsed = parseWaitConfig(candidate.config)
      // An ORDINARY wait starts a new relative moment — stop here, so a
      // post-event follow-up ("how did it go?") still reaches somebody who
      // signed up too late for the countdown itself. An anchored wait that
      // cannot be READ also stops the scan, so the ordinary decision path
      // reports the fault next tick with its own sentence; this function
      // never reports somebody else's parse error.
      if (parsed === null || !parsed.ok) {
        return { kind: "advance", toPosition: candidate.position, note: ANCHOR_MOMENT_PASSED_NOTE }
      }
      // `ctx.anchorAt` cannot be null here — the caller returned `complete`
      // for that before ever reaching this function.
      const target = anchorMoment(ctx.anchorAt ?? "", parsed.value.daysBeforeAnchor)
      if (Number.isNaN(target.getTime()) || target.getTime() > ctx.now.getTime()) {
        return { kind: "advance", toPosition: candidate.position, note: ANCHOR_MOMENT_PASSED_NOTE }
      }
      // This moment has passed too — keep skipping, and take its whole block
      // with it.
      continue
    }

    // A `stop`. Land on it; the next decision completes the run.
    return { kind: "advance", toPosition: candidate.position, note: ANCHOR_MOMENT_PASSED_NOTE }
  }

  return { kind: "complete" }
}

/**
 * Why a run jumped forward without sending.
 *
 * NOT PERSISTED TODAY, and saying so because an earlier version of this
 * comment claimed it was. The runner's `advance` arm
 * (lib/automation/sequence-tick-runner.ts) calls
 * `advanceRun(run.id, action.toPosition, action.deferUntil)` and drops
 * `action.note`; `advanceRun` (lib/db/sequences.ts) has no parameter for one
 * and writes nothing. So a coach reading the run sees a gap in the positions
 * with no explanation — that is a real reporting gap, not a solved problem.
 * The constant exists so the decision is self-describing and testable, and so
 * that whoever adds a note column has the string already agreed.
 */
export const ANCHOR_MOMENT_PASSED_NOTE = "anchor_moment_passed"

/**
 * G11. Why a run ended when it met a countdown it had no anchor for.
 *
 * Kept as a named export because THREE places have to agree about it: the
 * sentence a coach reads (`lib/lead-engine/sequence-exit-reasons.ts`), the
 * reporting bucket (`lib/db/sequence-reporting.ts` — `other`, never
 * `finished`), and the re-enrolment cooldown (`hasRunFinishedWithin` in
 * lib/lead-engine/enroll.ts), which must FORGIVE it. Both inventories are
 * hand-maintained and this repo has already shipped one of them stale.
 */
export const NOT_ANCHORED_EXIT_REASON = "not_anchored"

/** Guardrails that apply to sendable kinds only, in the order asserted by tests. */
function sendGuardrailDefer(run: SequenceRunRow, ctx: DecisionContext): { until: Date; reason: string } | null {
  const sibling = siblingRunDefer({ id: run.id, enrolled_at: run.enrolled_at }, ctx.activeSiblings, ctx.now)
  if (sibling) return { until: sibling, reason: "sibling_run" }

  const cap = dailyCapDefer(ctx.now, ctx.timezone, ctx.dailyCap, ctx.sentAtToday)
  if (cap) return { until: cap, reason: "daily_cap" }

  const quiet = quietHoursDefer(ctx.now, ctx.timezone, ctx.quiet)
  if (quiet) return { until: quiet, reason: "quiet_hours" }

  return null
}

export function decideStep(run: SequenceRunRow, steps: SequenceStepRow[], ctx: DecisionContext): StepAction {
  if (ctx.isSuppressed) return { kind: "exit", reason: "suppressed" }

  const step = steps.find((s) => s.position === run.current_position)
  if (!step) return { kind: "complete" }

  switch (step.kind) {
    case "stop":
      return { kind: "complete" }

    case "email": {
      if (!ctx.contact.email) {
        return { kind: "advance", toPosition: step.position + 1, note: "no_email_address" }
      }
      const defer = sendGuardrailDefer(run, ctx)
      if (defer) return { kind: "defer", ...defer }
      return { kind: "send", step, channel: "email" }
    }

    case "sms": {
      if (!ctx.contact.phone_e164) {
        return { kind: "advance", toPosition: step.position + 1, note: "no_phone_number" }
      }
      if (!ctx.hasSmsConsent) {
        return { kind: "advance", toPosition: step.position + 1, note: "no_sms_consent" }
      }
      const defer = sendGuardrailDefer(run, ctx)
      if (defer) return { kind: "defer", ...defer }
      return { kind: "send", step, channel: "sms" }
    }

    case "wait": {
      // G11. An ANCHORED wait counts down to a fixed moment instead of up
      // from now. Parsed FIRST, before the anchor is looked at, so that a
      // malformed step fails identically whether or not the run happens to
      // carry an anchor — otherwise the error a coach sees would depend on
      // which contact reached the step.
      const anchored = parseWaitConfig(step.config)
      if (anchored !== null) {
        if (!anchored.ok) return { kind: "fail", error: anchored.error }

        // Nothing to count down to. END the run rather than send: a run
        // enrolled before migration 00267, one enrolled during the one-deploy
        // window where the column does not exist yet, a coach hand-enrolling
        // somebody into a camp sequence with no event behind it, or a coach
        // putting an anchored wait into a sequence no event ever triggers.
        // "Three days to go" before nothing is worse than silence.
        //
        // EXIT, NOT COMPLETE, and the difference is not cosmetic. A
        // `completed` run counts towards G01's re-enrolment cooldown
        // (`hasRunFinishedWithin`), so a hand-enrolled run ending here would
        // lock the person out of the sequence for the cooldown window — and
        // their REAL camp signup a week later would be refused, leaving them
        // with no countdown for a camp they actually signed up for. Exiting
        // with a reason lets that function forgive it, exactly as it forgives
        // `failed` and `superseded`.
        //
        // Deliberately not `fail` either: there is no fault to report to
        // anybody, and a failed run sits on the sequences screen forever.
        if (ctx.anchorAt === null) return { kind: "exit", reason: NOT_ANCHORED_EXIT_REASON }

        const target = anchorMoment(ctx.anchorAt, anchored.value.daysBeforeAnchor)
        // An Invalid Date compares false against everything, including
        // itself, so it would silently fall through to the skip path and
        // complete the run. Caught explicitly instead.
        if (Number.isNaN(target.getTime())) {
          return { kind: "fail", error: "This sequence is counting down to an event date we cannot read." }
        }

        // Still ahead: hold until exactly that moment. `wait_minutes` is
        // ignored on purpose — both columns set is a hand-edit or a
        // half-finished conversion, and the anchor is the more specific
        // instruction. Adding them together would be the worst of both.
        if (target.getTime() > ctx.now.getTime()) {
          return { kind: "advance", toPosition: step.position + 1, deferUntil: target }
        }

        // The moment has passed, so every message it was gating is now
        // false — "two weeks to go" five days before the camp. Skip to where
        // the countdown is still true. NOTE that a plain advance would NOT
        // do: a defer in the past is claimed again immediately, which sends
        // the stale reminder rather than skipping it.
        return skipPastAnchoredMoment(step, steps, ctx)
      }

      const minutes = step.wait_minutes ?? 0
      return {
        kind: "advance",
        toPosition: step.position + 1,
        deferUntil: new Date(ctx.now.getTime() + minutes * 60 * 1000),
      }
    }

    case "branch": {
      if (!step.branch_condition) {
        return { kind: "fail", error: "branch step has no branch_condition" }
      }
      const result = evaluateBranch(step.branch_condition, ctx)
      if (!result.ok) return { kind: "fail", error: result.error }

      const target = result.value ? step.on_true_position : step.on_false_position
      return { kind: "advance", toPosition: target ?? step.position + 1 }
    }

    case "alert":
      return { kind: "alert", step }

    case "tag": {
      // Malformed config FAILS rather than advancing, matching `branch` above.
      // The reasoning is the same: there is no correct default for a tag step
      // with no tag. Failing puts the reason on `sequence_runs.last_error`,
      // which the contact detail page renders beside the run, so a human can
      // see it. It is NOT recoverable — `status='failed'` is terminal and
      // nothing re-activates a failed run (the `/admin/sequences` screen,
      // merged 2026-09-07, reports failed runs in aggregate but has no action
      // to resume or retry one). A silent skip is neither visible nor
      // recoverable, which is why fail still wins.
      const parsed = parseTagConfig(step.config)
      if (!parsed.ok) return { kind: "fail", error: parsed.error }
      return { kind: "tag", step, tag: parsed.value.tag }
    }

    case "stage": {
      // Same rule as `tag` and `branch`. A stage step with no stage could
      // otherwise be guessed into moving a real person's card to the wrong
      // column, which is worse than stopping.
      const parsed = parseStageConfig(step.config)
      if (!parsed.ok) return { kind: "fail", error: parsed.error }
      return { kind: "stage", step, pipelineKey: parsed.value.pipelineKey, stageKey: parsed.value.stageKey }
    }

    default: {
      const _exhaustive: never = step.kind
      return { kind: "fail", error: `unsupported step kind: ${_exhaustive}` }
    }
  }
}
