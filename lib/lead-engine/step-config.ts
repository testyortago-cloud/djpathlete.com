// lib/lead-engine/step-config.ts — what a `tag` or `stage` step's `config`
// column is allowed to say, as pure functions.
//
// PURE ON PURPOSE, for two reasons that pull in the same direction:
//
//  1. `lib/automation/sequence-tick.ts` imports this, and that module's own
//     header forbids it from importing any IO. Its tests run with zero mocks
//     and must keep doing so.
//  2. The sequence step editor is a later item, and it has to reject exactly
//     what the tick rejects. One implementation is the only way that stays
//     true; two validators drift, and the operator learns about it when a
//     saved step fails silently at 3am.
//
// Same pure/impure split lib/contacts/tag-format.ts keeps from
// lib/db/contact-tags.ts, and for the same reason.

import { normaliseTag } from "@/lib/contacts/tag-format"

export type TagStepConfig = { tag: string }
export type StageStepConfig = { stageKey: string; pipelineKey: string | null }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** A trimmed non-empty string, or null for anything else. Not exported: both parsers want the same rule. */
function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * `{ "tag": "warm-lead" }`.
 *
 * The returned tag is the NORMALISED one — lowercased, whitespace collapsed —
 * because that is what `addTag` will actually store. Returning the raw string
 * would let a step's config and the stored row disagree, which is the exact
 * failure `normaliseTag`'s own header describes: an operator who cannot delete
 * a tag by typing what they see.
 *
 * Rejecting here rather than inside `addTag` means an unstorable tag fails the
 * run at the DECISION, where the reason lands on `sequence_runs.last_error` and
 * the contact detail page renders it beside the run — instead of throwing four
 * layers down where nothing surfaces it. Visible, note, not recoverable:
 * `status='failed'` is terminal and nothing here re-activates a failed run.
 * (The `/admin/sequences` screen, merged 2026-09-07, reports failed runs in
 * aggregate but has no action to resume or retry one.)
 */
export function parseTagConfig(config: Record<string, unknown>): ParseResult<TagStepConfig> {
  const raw = config.tag
  if (raw === undefined || raw === null) {
    return { ok: false, error: "This sequence's tag step does not say which tag to add." }
  }
  const tag = normaliseTag(typeof raw === "string" ? raw : null)
  if (tag === null) {
    return { ok: false, error: "This sequence's tag step names a tag that is blank or too long." }
  }
  return { ok: true, value: { tag } }
}

/**
 * `{ "stage": "consulted" }`, optionally `{ "stage": "...", "pipeline": "coaching" }`.
 *
 * `pipeline` is accepted now, while there is one board, because resolving a
 * board by key costs the same as assuming the default one and a later item adds
 * more boards. An ABSENT pipeline yields null, which the caller turns into the
 * default key — absent and empty are different answers, and an empty string is
 * a mistake worth reporting rather than silently treating as "the default".
 */
export function parseStageConfig(config: Record<string, unknown>): ParseResult<StageStepConfig> {
  const stageKey = requiredString(config.stage)
  if (stageKey === null) {
    return { ok: false, error: "This sequence's stage step does not say which stage to move the person to." }
  }

  if (config.pipeline === undefined || config.pipeline === null) {
    return { ok: true, value: { stageKey, pipelineKey: null } }
  }

  const pipelineKey = requiredString(config.pipeline)
  if (pipelineKey === null) {
    return { ok: false, error: "This sequence's stage step does not say which pipeline to use." }
  }
  return { ok: true, value: { stageKey, pipelineKey } }
}

/**
 * G11. How long an ANCHORED wait holds: `N` days before the run's
 * `anchor_at`, rather than N minutes after the run reached the step.
 *
 * `daysBeforeAnchor` counts BACKWARDS, so 14 means "fourteen days before the
 * camp" and 0 means "the moment the camp starts". There is deliberately no way
 * to say "after" — see `parseWaitConfig`.
 */
export type WaitAnchorConfig = { daysBeforeAnchor: number }

/**
 * The furthest ahead an anchored wait may be set.
 *
 * An anchored wait writes `next_run_at` DIRECTLY, so a mistyped 3650 would
 * park a run until 2036 with no error on the run, nothing in the logs and no
 * failed status — invisible until somebody wondered why a camp sequence never
 * sent. A refusal at the decision is loud instead: it fails the run, and the
 * sentence lands on `sequence_runs.last_error`, which the contact detail page
 * renders beside the run.
 *
 * Two years, because a camp booked eighteen months out is a real thing and a
 * reminder more than two years before one is not.
 */
export const WAIT_ANCHOR_MAX_DAYS_BEFORE = 730

/**
 * `{ "wait_until": { "days_before_anchor": 14 } }`, or `null` when this is an
 * ordinary `wait_minutes` step.
 *
 * NULL IS NOT A REFUSAL, AND THAT DISTINCTION IS THE WHOLE SIGNATURE. Almost
 * every `wait` step in the product has no `wait_until` at all, and returning
 * `{ok:false}` for those would fail every existing sequence the moment this
 * shipped. So: absent → `null` → the caller uses `wait_minutes` exactly as
 * before. Present but malformed → `{ok:false}` → the run fails visibly,
 * because a step that MEANT to be anchored and cannot be read must never
 * quietly degrade into "wait zero minutes, so send now". That degrade is the
 * dangerous direction: it fires a "3 days to go" email at an arbitrary moment.
 *
 * `config` is `jsonb` with no CHECK constraint behind it, so every shape
 * rejected below is reachable from a hand-edited row, a migration, or an
 * older client. None of them can be assumed away.
 */
export function parseWaitConfig(config: Record<string, unknown>): ParseResult<WaitAnchorConfig> | null {
  const raw = config.wait_until
  if (raw === undefined) return null

  // Present-but-unusable is a fault, not an absence. `typeof null === "object"`
  // and an array is an object too, so both are excluded explicitly rather than
  // left to fall through into the property read below.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "This sequence's wait step does not say when to send, in a way we can read." }
  }

  const days = (raw as { days_before_anchor?: unknown }).days_before_anchor
  // `Number.isInteger` rather than `typeof === "number"`: it rejects NaN,
  // Infinity and 2.5 in one check. A fraction is not a day, and NaN or
  // Infinity would each produce an Invalid Date and park the run forever.
  if (!Number.isInteger(days)) {
    return { ok: false, error: "This sequence's wait step does not say how many days before the event to send." }
  }

  const value = days as number
  if (value < 0) {
    // A deadline chaser that fires AFTER the deadline is the one thing this
    // row exists to stop. If "after the event" is ever wanted, it needs its
    // own key, so that it is a decision somebody made rather than a sign error.
    return {
      ok: false,
      error: "This sequence's wait step counts days before the event, so it cannot be a negative number.",
    }
  }
  if (value > WAIT_ANCHOR_MAX_DAYS_BEFORE) {
    return {
      ok: false,
      error: `This sequence's wait step says more than ${WAIT_ANCHOR_MAX_DAYS_BEFORE} days before the event, which is further ahead than we can plan for.`,
    }
  }

  return { ok: true, value: { daysBeforeAnchor: value } }
}
