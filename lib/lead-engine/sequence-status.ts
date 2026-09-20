// lib/lead-engine/sequence-status.ts — one `sequence_runs` row as the short
// badge a coach reads in a LIST.
//
// The long-form sibling is sequence-exit-reasons.ts, which writes the full
// sentence for a single run on a detail screen. This file is what fits in a
// table cell. They are deliberately not two wordings of the same thing: the
// `detail` returned here IS `exitReasonSentence`'s output, so the contact
// list, the contact's own screen and the sequence's people list cannot end up
// saying three different things about one row — the exact drift that file's
// header was written to stop.
//
// PURE — no database client, no session, no React. Same shape and the same
// reason as sequence-exit-reasons.ts and manual-enrol.ts: a client component
// renders this, and a module that reached `@/lib/supabase` at import time
// would drag a service-role client into a browser bundle.
//
// TWO COLUMNS HERE ARE PLAIN `text` WITH NO CHECK CONSTRAINT, and both have
// already gained values in production that no TypeScript union declared:
// `exit_reason` (see the sibling file's header — `suppressed` and
// `sequence_edited` both arrived that way) and `status`. So neither switch
// below has a "this cannot happen" arm. An unrecognised STATUS in particular
// must not fall through to the active arm: printing "step 3 of 8" for a run
// that is not running tells a coach somebody is being messaged when nobody
// actually knows that.
//
// `failed` IS A FIRST-CLASS STATE ON THIS SURFACE, and it is the one the ledger
// row for this column did not mention. 73 of the 77 runs in production hold it
// — the incident CLAUDE.md records — so rendering them as "—" would tell a
// coach those people are simply not in a follow-up, when the truth is that
// theirs broke and nobody is being messaged.

import { exitReasonSentence } from "@/lib/lead-engine/sequence-exit-reasons"

/** The DataTableBadge tones, restated rather than imported so this stays free of React. */
export type SequenceStatusTone = "neutral" | "success" | "warning" | "info" | "danger"

/**
 * The latest run for one contact, reduced to what a badge needs.
 *
 * `current_position` names the step that goes out NEXT, not the last one sent
 * (migration 00256's own note, and the reason G12's alert had to be positioned
 * with care).
 *
 * `messagePositions` IS NOT A STEP COUNT, and the difference is the whole
 * reason this field has that shape. A sequence's rows are not all messages:
 * production holds `email`, `sms`, `wait`, `branch`, `stop`, `tag` and `alert`,
 * and `new_lead_nurture` is EIGHT rows that send FOUR messages — three emails,
 * one text, three waits and a stop. A badge reading "step 3 of 8" invites a
 * coach to believe eight things will arrive, and `alert` does not even go to
 * the person: it goes to the coach (G12).
 *
 * So this carries the POSITIONS of the steps that actually message the person,
 * which is enough to say both how many there are and how many have gone. Null
 * means "could not be read", which is not the same as an empty array — a
 * sequence that genuinely sends nothing.
 */
export interface LatestSequenceRun {
  status: string
  exit_reason: string | null
  current_position: number
  sequence_name: string
  messagePositions: number[] | null
}

export interface SequenceStatusLabel {
  /** Fits a table cell. Never blank — "—" is the answer for nobody. */
  label: string
  tone: SequenceStatusTone
  /** The full sentence, for a title attribute. `null` when there is nothing more to say. */
  detail: string | null
}

const NOT_IN_ANY: SequenceStatusLabel = { label: "—", tone: "neutral", detail: null }

/**
 * The three ways a person says stop. One badge, three sentences.
 *
 * Collapsed on the list because a coach scanning a hundred rows needs one
 * shape for "do not contact"; kept apart in `detail` because an email
 * unsubscribe, a texted STOP and "was already on the do-not-contact list
 * before we reached them" are three different things to act on.
 */
const OPT_OUT_REASONS = new Set(["unsubscribed", "sms_stop", "suppressed"])

/** Turns `paused_by_something_new` into `Paused by something new`. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim()
  if (spaced.length === 0) return "Unknown"
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * ` · 2 of 4 sent`, or nothing at all.
 *
 * COUNTED AS SENT RATHER THAN AS "STEP N OF M", because every other phrasing
 * is wrong somewhere along the run. "Step 1 of 4" for somebody who has had
 * nothing yet overstates it; "step 4 of 4" for somebody parked on the wait
 * after the last message understates it. How many have actually gone out is
 * true at every position, including the two ends, and needs no clamping.
 *
 * `current_position` names the step about to run, so a message step at a
 * position BELOW it has already been sent. Empty when the positions could not
 * be read, or when the sequence messages nobody — "0 of 0 sent" is not a fact
 * worth a badge.
 */
function sentSuffix(currentPosition: number, messagePositions: number[] | null): string {
  if (messagePositions === null || messagePositions.length === 0) return ""
  const sent = messagePositions.filter((position) => position < currentPosition).length
  return ` · ${sent} of ${messagePositions.length} sent`
}

/**
 * What the Follow-up column shows for one contact.
 *
 * `null` in — nobody found a run for this person — gives "—" rather than
 * blank, so an empty cell always means the column rendered and this person has
 * nothing, never that something failed to load.
 */
export function describeSequenceStatus(run: LatestSequenceRun | null): SequenceStatusLabel {
  if (run === null) return NOT_IN_ANY

  if (run.status === "active") {
    return {
      label: `${run.sequence_name}${sentSuffix(run.current_position, run.messagePositions)}`,
      tone: "info",
      detail: null,
    }
  }

  if (run.status === "completed") {
    return { label: "Finished", tone: "neutral", detail: `They received every message in ${run.sequence_name}.` }
  }

  if (run.status === "failed") {
    return {
      label: "Stopped early",
      tone: "danger",
      detail: `Their ${run.sequence_name} follow-up hit a problem and stopped. Nobody is being messaged.`,
    }
  }

  if (run.status === "exited") {
    const detail = exitReasonSentence(run.exit_reason)
    if (run.exit_reason === "payment") return { label: "Bought", tone: "success", detail }
    if (run.exit_reason === "booking") return { label: "Booked a call", tone: "success", detail }
    if (run.exit_reason !== null && OPT_OUT_REASONS.has(run.exit_reason)) {
      return { label: "Opted out", tone: "warning", detail }
    }
    return { label: "Stopped", tone: "neutral", detail }
  }

  // A status no release has planned for. Readable prose, never the raw slug
  // with its underscores showing, and never the active arm.
  return { label: humanize(run.status), tone: "neutral", detail: null }
}
