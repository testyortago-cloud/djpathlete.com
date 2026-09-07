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
 * run at the DECISION, where the reason is visible on the sequence screen,
 * instead of throwing four layers down.
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
