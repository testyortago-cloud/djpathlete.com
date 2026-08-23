// lib/lead-engine/manual-enrol.ts — the pure half of enrolling contacts into a
// sequence by hand: what the request must look like, and what the screen says
// when it comes back.
//
// Neither piece belongs in the route handler or in the React component,
// because BOTH need both. The batch cap enforced by
// app/api/admin/sequences/enrol/route.ts is the same cap
// components/admin/contacts/ContactsTable.tsx must stop the operator at — a
// cap the server owns and the client guesses at is a cap they will eventually
// disagree about, and the way that gets discovered is a rejected request after
// someone has already selected a page of people.
//
// Importing this module pulls in nothing: no database client, no `next/server`,
// no session. That is deliberate — it is what lets the client component share
// the wording and the cap without dragging the service-role Supabase client
// into the browser bundle.
//
// ---------------------------------------------------------------------------
// WHY THE WORDING IS CODE AND NOT A STRING IN THE COMPONENT
// ---------------------------------------------------------------------------
// `cold_lead_re_engagement` — the sequence this whole surface exists to make
// reachable — is seeded `draft` (migration 00218, which also records that "no
// manual-enrol surface exists yet"). `enrolContactManually` refuses anything
// that is not `active`. So "the sequence is not active" is not a rare error
// path here: IT IS THE FIRST THING A REAL USER HITS. Reporting that as
// "Could not enrol those contacts" would send a coach hunting for a bug that
// does not exist, when the true answer is one sentence and a next step.
// `scripts/enrol-repermission.ts` prints exactly this distinction at the tail
// of a run; this is the same honesty on a screen.

/**
 * The largest number of contacts one request may enrol.
 *
 * Set to the page size of /admin/contacts, so "tick the select-all box and
 * enrol everyone on this page" is exactly the biggest legal batch and the
 * operator can never assemble a selection the server will refuse.
 *
 * It is a cap at all because `enrolContactManually` is called once per
 * contact, and each call is its own round trip to Postgres (a `sequences`
 * lookup plus a `sequence_runs` insert). An uncapped list is a request that
 * runs until the platform's function timeout kills it mid-loop — and a killed
 * request leaves an unknowable number of people enrolled with NO tally ever
 * reaching the screen, which is strictly worse than refusing up front. 100
 * enrolments finish inside this route's `maxDuration` with room to spare.
 */
export const MAX_ENROL_BATCH = 100

/**
 * The five outcomes `ManualEnrolOutcome` (lib/lead-engine/enroll.ts) can
 * produce, plus `failed` — which is NOT one of that type's outcomes. It counts
 * contacts whose enrolment THREW, i.e. a real database error, which the route
 * catches per contact so one bad row cannot abort the rest of the batch.
 * Keeping it a separate key rather than folding it into `sequence_not_found`
 * matters: those two suggest completely different next steps.
 */
export type EnrolOutcomeKey =
  | "enrolled"
  | "already_enrolled"
  | "already_enrolled_once"
  | "sequence_not_found"
  | "sequence_not_active"
  | "failed"

export type EnrolTally = Record<EnrolOutcomeKey, number>

export function emptyTally(): EnrolTally {
  return {
    enrolled: 0,
    already_enrolled: 0,
    already_enrolled_once: 0,
    sequence_not_found: 0,
    sequence_not_active: 0,
    failed: 0,
  }
}

export type ParsedEnrolRequest =
  | { ok: true; contactIds: string[]; sequenceKey: string; onePerContact: boolean }
  | { ok: false; error: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Validates a POST body into something safe to loop over.
 *
 * REJECTS rather than repairs. A body carrying one malformed id could be
 * "fixed" by filtering it out, but then the request enrols fewer people than
 * the operator selected and still reports success — the one kind of failure
 * they have no way to notice. Refusing the whole batch makes it visible.
 *
 * `onePerContact` must be a real boolean, not merely truthy: the string
 * "false" is truthy, so a caller that posted its checkbox as text would turn
 * the guard ON while the box on screen was unticked.
 */
export function parseEnrolRequest(raw: unknown): ParsedEnrolRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Expected a JSON object body." }
  }
  const body = raw as { contactIds?: unknown; sequenceKey?: unknown; onePerContact?: unknown }

  if (!isNonEmptyString(body.sequenceKey)) {
    return { ok: false, error: "sequenceKey is required." }
  }

  if (!Array.isArray(body.contactIds) || body.contactIds.length === 0) {
    return { ok: false, error: "contactIds must be a non-empty array." }
  }
  if (!body.contactIds.every(isNonEmptyString)) {
    return { ok: false, error: "Every entry in contactIds must be a non-empty string." }
  }

  if (body.onePerContact !== undefined && typeof body.onePerContact !== "boolean") {
    return { ok: false, error: "onePerContact must be true or false." }
  }

  // De-duplicated BEFORE the cap is applied, so selecting the same contact
  // twice costs one slot rather than two.
  const contactIds = [...new Set(body.contactIds.map((id) => id.trim()))]
  if (contactIds.length > MAX_ENROL_BATCH) {
    return {
      ok: false,
      error: `Too many contacts at once — enrol at most ${MAX_ENROL_BATCH} in one go.`,
    }
  }

  return {
    ok: true,
    contactIds,
    sequenceKey: body.sequenceKey.trim(),
    // Default false, matching `enrolContactManually`'s own documented default
    // and for its documented reason: a re-engagement sequence is SUPPOSED to be
    // runnable again against someone whose earlier run finished.
    onePerContact: body.onePerContact === true,
  }
}

export interface EnrolResultMessage {
  tone: "success" | "warning" | "error"
  headline: string
  detail?: string
}

function contacts(n: number): string {
  return n === 1 ? "1 contact" : `${n} contacts`
}

/**
 * Plain-words description of a finished batch, for a coach rather than for a
 * developer. Reads the whole tally, not just the first non-zero key, because a
 * batch routinely ends up in more than one bucket at once.
 *
 * Order of precedence is deliberate:
 *
 *   1. `sequence_not_active` / `sequence_not_found` first. These are decided
 *      ONCE, for the whole batch, by the sequence itself — every contact gets
 *      the same answer — so they are a statement about the sequence, not about
 *      the people, and they are the only ones that carry a next step.
 *   2. Then whether anyone was actually added.
 *   3. Then the skips and failures, as detail.
 */
export function describeEnrolResult(args: {
  tally: EnrolTally
  sequenceName: string
  /** The sequence's real status, when the refusal reported one. */
  sequenceStatus: string | null
}): EnrolResultMessage {
  const { tally, sequenceName } = args

  if (tally.sequence_not_active > 0) {
    // Say the status out loud rather than "not active": "draft" and "paused"
    // mean different things to the person deciding what to do next.
    const status = args.sequenceStatus ?? "not switched on"
    const article = status === "draft" ? "still a draft" : status === "paused" ? "paused" : `set to "${status}"`
    return {
      tone: "error",
      headline: `Nobody was enrolled — "${sequenceName}" is ${article}.`,
      detail:
        "A sequence only starts sending once someone switches it on. Nothing was sent, and nobody was added. " +
        "Switch this sequence on first, then enrol these contacts again.",
    }
  }

  if (tally.sequence_not_found > 0) {
    return {
      tone: "error",
      headline: `Nobody was enrolled — "${sequenceName}" no longer exists.`,
      detail: "It may have been removed since this page was loaded. Reload the page and pick again.",
    }
  }

  const skipped: string[] = []
  if (tally.already_enrolled > 0) {
    skipped.push(`${contacts(tally.already_enrolled)} were already in it, so nothing changed for them`)
  }
  if (tally.already_enrolled_once > 0) {
    skipped.push(`${contacts(tally.already_enrolled_once)} had been in it before, so they were skipped`)
  }
  if (tally.failed > 0) {
    skipped.push(`${contacts(tally.failed)} could not be enrolled — try those again`)
  }
  const detail = skipped.length > 0 ? `${skipped.join(". ")}.` : undefined

  if (tally.enrolled > 0) {
    return {
      tone: tally.failed > 0 ? "warning" : "success",
      headline: `Enrolled ${contacts(tally.enrolled)} into "${sequenceName}".`,
      detail,
    }
  }

  if (tally.failed > 0) {
    return {
      tone: "error",
      headline: `Nobody was added to "${sequenceName}".`,
      detail,
    }
  }

  return {
    tone: "warning",
    headline: `Nobody new was added — everyone you picked is already in "${sequenceName}".`,
    detail,
  }
}
