// Pure decision core for the Lead Engine sequence tick.
//
// This module must import nothing except pure helpers from
// `lib/lead-engine/guardrails.ts` (and pure type imports) — no
// `@/lib/supabase`, no DAL, no I/O of any kind. That purity is what lets its
// tests run with zero mocks. A later task (`lib/automation/sequence-tick-runner.ts`)
// wraps this in database IO; do not add any of that here.

import { quietHoursDefer, dailyCapDefer, siblingRunDefer } from "@/lib/lead-engine/guardrails"
import type { QuietHours } from "@/lib/lead-engine/guardrails"

export type StepKind = "email" | "sms" | "wait" | "branch" | "tag" | "stage" | "alert" | "stop"

export type BranchCondition =
  | { kind: "has_phone" }
  | { kind: "has_user" }
  | { kind: "has_consent"; channel: "email" | "sms" }
  | { kind: "source_is"; value: string }

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
}

export type StepAction =
  | { kind: "send"; step: SequenceStepRow; channel: "email" | "sms" }
  | { kind: "alert"; step: SequenceStepRow }
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
    default:
      // An unknown predicate must FAIL the run, never default to a boolean —
      // guessing which branch arm is correct can send the wrong message to a
      // real person. A failed run is visible and recoverable; a wrong guess
      // is not.
      return { ok: false, error: `unknown branch condition: ${(condition as { kind: string }).kind}` }
  }
}

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

    case "tag":
    case "stage":
      return { kind: "advance", toPosition: step.position + 1, note: "unsupported_kind" }

    default: {
      const _exhaustive: never = step.kind
      return { kind: "fail", error: `unsupported step kind: ${_exhaustive}` }
    }
  }
}
