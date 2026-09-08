// lib/ai/recover-object.ts — rescue a structured response the model
// DOUBLE-ENCODED.
//
// ---------------------------------------------------------------------------
// THE FAILURE THIS EXISTS FOR
// ---------------------------------------------------------------------------
// `streamObject` with `structuredOutputMode: "jsonTool"` asks the model for a
// tool call whose arguments ARE the object. Occasionally the model instead
// sends a one-key wrapper whose value is the object as a JSON STRING:
//
//   {"params": "{\"reply\": \"...\", \"blocked\": true, \"ops\": []}"}
//
// Zod then reports every top-level key as missing, the AI SDK raises
// `AI_NoObjectGeneratedError`, and the caller treats a COMPLETE, VALID answer
// as a failed turn. Observed three times in one afternoon on the funnel page
// builder (`ai_generation_log`, 2026-09-08) and reproduced against the live
// model before this file was written — the recovered payload below is the
// literal text of one of those responses.
//
// The retry does not save it: the wrapper is not something the model knows it
// did, so attempt two makes the same move and the owner sees "I couldn't build
// that" for a request the model had already answered.
//
// ---------------------------------------------------------------------------
// WHY UNWRAPPING BLIND IS SAFE HERE
// ---------------------------------------------------------------------------
// Every candidate is validated against the CALLER'S OWN SCHEMA before it is
// returned, and `null` is the answer when none of them parse. So a wrong guess
// costs nothing: it cannot widen what the caller accepts, only recover
// something the caller would already have accepted had it arrived unwrapped.
// That is why the descent does not hardcode `"params"` — the key is the
// model's invention and has been seen as `input` and `arguments` elsewhere —
// while still refusing to strip a wrapper that carries more than one key,
// which would be discarding data rather than unwrapping it.
// ---------------------------------------------------------------------------

import type { ZodType } from "zod"

/** Guards against a pathological chain of wrappers. Two is already unheard of. */
const MAX_UNWRAP_DEPTH = 4

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Every object worth validating, outermost first.
 *
 * The outermost is included deliberately: when the response was NOT wrapped,
 * the first candidate is the response itself, so a caller can use this on any
 * failure without first deciding whether the failure was a wrapping one.
 */
export function unwrapCandidates(raw: unknown): unknown[] {
  const candidates: unknown[] = []
  let cursor: unknown = raw

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    if (typeof cursor === "string") {
      cursor = tryParseJson(cursor)
    }
    if (!isPlainObject(cursor)) break

    candidates.push(cursor)

    // Only a SINGLE-key wrapper is a wrapper. Anything else is the payload.
    const keys = Object.keys(cursor)
    if (keys.length !== 1) break
    cursor = cursor[keys[0]]
  }

  return candidates
}

/**
 * The offending value, dug out of an `AI_NoObjectGeneratedError`.
 *
 * Two places carry it and neither is guaranteed: `.text` is the raw assistant
 * text and `.cause.value` is what type validation was handed. Both are tried,
 * because which one is populated depends on where in the SDK the failure was
 * raised, and a recovery that works only on one of them would come and go with
 * an SDK upgrade.
 */
function offendingValues(error: unknown): unknown[] {
  if (!isPlainObject(error as Record<string, unknown>) && !(error instanceof Error)) return []
  const err = error as { text?: unknown; cause?: unknown }
  const values: unknown[] = []
  if (typeof err.text === "string" && err.text.trim() !== "") values.push(err.text)
  if (isPlainObject(err.cause) && "value" in err.cause) values.push(err.cause.value)
  return values
}

/**
 * The model's object, recovered from any value that might be wrapping it.
 *
 * Separate from `recoverObjectFromError` because the two failure shapes carry
 * the payload in different places, and only one of them is an error: when the
 * SDK rejects during the STREAM TRANSFORM rather than at the final parse, what
 * arrives is a bare `ZodError` with no `.text` and no `.value`, and the last
 * partial object the stream emitted is the only surviving copy.
 *
 * NEVER THROWS — see the contract on `recoverObjectFromError`.
 */
export function recoverObjectFromValue<T>(value: unknown, schema: ZodType<T>): T | null {
  try {
    for (const candidate of unwrapCandidates(value)) {
      const parsed = schema.safeParse(candidate)
      if (parsed.success) return parsed.data
    }
  } catch {
    // Deliberately swallowed — see the contract above.
  }
  return null
}

/**
 * The model's object, recovered from a schema failure, or `null`.
 *
 * NEVER THROWS. A caller reaches this only on a path that has already failed,
 * so a recovery that can itself fail would turn one handled failure into an
 * unhandled one.
 */
export function recoverObjectFromError<T>(error: unknown, schema: ZodType<T>): T | null {
  try {
    for (const value of offendingValues(error)) {
      const recovered = recoverObjectFromValue(value, schema)
      if (recovered !== null) return recovered
    }
  } catch {
    // Deliberately swallowed — see the contract above.
  }
  return null
}

/**
 * What actually went wrong, as lines a MODEL can act on.
 *
 * `error.message` alone is "No object generated: response did not match
 * schema.", which names no field and no value. Feeding that back as the retry's
 * only correction is why attempt two repeats attempt one verbatim: the model is
 * told it was wrong and not told about what.
 */
export function describeModelError(error: unknown): string[] {
  const err = error as { message?: unknown; cause?: unknown }
  const headline = typeof err?.message === "string" ? err.message : String(error)

  const issues = zodIssuesOf(err?.cause)
  if (issues.length === 0) return [headline]

  // Capped: a rejected 24-section page can produce hundreds of issues, and a
  // retry prompt made mostly of them crowds out the document it must fix.
  const shown = issues.slice(0, 10)
  const overflow = issues.length > shown.length ? [`(and ${issues.length - shown.length} more)`] : []
  return [headline, ...shown, ...overflow]
}

/**
 * Zod issues out of a nested cause chain, as `path: message` lines.
 *
 * The chain is `AI_NoObjectGeneratedError -> AI_TypeValidationError ->
 * ZodError`, and the ZodError arrives with its issues on `.issues` — except
 * when it has been serialized, where they survive only as JSON in `.message`.
 * Both are read for the reason `offendingValues` reads two places.
 */
function zodIssuesOf(cause: unknown, depth = 0): string[] {
  if (depth > 3 || !isPlainObject(cause)) return []

  const raw = Array.isArray(cause.issues)
    ? cause.issues
    : typeof cause.message === "string"
      ? tryParseJson(cause.message)
      : undefined

  if (Array.isArray(raw)) {
    const lines = raw.filter(isPlainObject).map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : ""
      const message = typeof issue.message === "string" ? issue.message : "invalid"
      return path ? `${path}: ${message}` : message
    })
    if (lines.length > 0) return lines
  }

  return zodIssuesOf(cause.cause, depth + 1)
}
