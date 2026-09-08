// lib/lead-engine/sequence-exit-reasons.ts — the one place a
// `sequence_runs.exit_reason` value becomes a sentence a coach can read.
//
// Shared by components/admin/sequences/SequenceRunsTable.tsx (a sequence's own
// person list) and components/admin/contacts/ContactDetail.tsx (the same run,
// read from the contact's side). Before this file existed the two had their
// own copies, and they drifted: the sequences screen said "Stopped because the
// sequence was edited" for a `sequence_edited` run, while the contact screen
// printed the raw string "sequence_edited" for the exact same row. Two admin
// screens disagreeing about one run is worse than either wording alone.
//
// PURE — no database client, no `next/server`, no session. Same shape as this
// directory's `manual-enrol.ts` (`describeEnrolResult`): importing this module
// pulls in nothing, which is what lets it be shared with no risk of dragging a
// service-role Supabase client into a bundle that should not have one, whether
// or not either caller happens to be a server component today.
// `lib/db/sequence-reporting.ts` was NOT reused for this, deliberately — it
// imports `createServiceRoleClient` from `@/lib/supabase` at module scope, so
// it is a data-access file, not a client-safe one, per this repo's own "one
// file per table" convention for `lib/db/`.
//
// THE DEFAULT ARM IS LOAD-BEARING, NOT DECORATION. `sequence_runs.exit_reason`
// is plain `text` with no check constraint (see migration 00216's own column
// comment), and `exitRun` / `exitRunsForContact` (lib/db/sequences.ts) both
// take a plain `string` — the exported `SequenceExitReason` union does not
// close the set. `lib/automation/sequence-tick.ts:116` already writes
// "suppressed", a value that union does not declare, and `sequence_edited`
// arrived the exact same way. A reason that shows up tomorrow with no
// sentence written for it yet must still read as something a coach can make
// sense of — never blank, and never the raw database value with its
// underscores showing.
//
// EVERY REASON THAT CAN REACH THE DATABASE TODAY, confirmed by grepping the
// verb that performs the exit — not the function signature that types it —
// across BOTH TypeScript and SQL. A TypeScript-only grep has produced a false
// "no writers" conclusion in this repo before, because `merge_contacts` is
// plpgsql:
//
//   payment                   app/api/stripe/webhook/route.ts:227
//   booking                   lib/bookings/ingest.ts:309
//   unsubscribed              lib/lead-engine/unsubscribe.ts:95
//   sms_stop                  app/api/webhooks/twilio/inbound/route.ts:278
//   suppressed                lib/automation/sequence-tick.ts:116
//   merged_into_survivor      supabase/migrations/00238_merge_contacts_carries_tags.sql
//   superseded_by_merged_run  supabase/migrations/00238_merge_contacts_carries_tags.sql
//   sequence_edited           supabase/migrations/00256_sequence_management.sql
//
// The three "stop contacting me" reasons (unsubscribed / sms_stop /
// suppressed) get three different sentences, on purpose, even though the list
// screen collapses them into one "Opted out" badge — an email unsubscribe, a
// texted STOP, and "was already on the do-not-contact list before we reached
// them" are three different things a coach would act on differently. The two
// merge reasons are written by the database itself during ordinary identity
// resolution, not from a button a coach pressed, so without a plain sentence
// they would read as a mysterious phrase with underscores in it.

const KNOWN_REASONS: Record<string, string> = {
  payment: "Bought something",
  booking: "Booked a call",
  unsubscribed: "Clicked unsubscribe in an email",
  sms_stop: "Replied STOP to a text",
  suppressed: "Was already on your do-not-contact list",
  merged_into_survivor: "Their details were merged into another person's record.",
  superseded_by_merged_run: "They were already in this sequence under another record.",
  sequence_edited: "Stopped because the sequence was edited",
}

/**
 * Turns underscores into spaces and capitalizes the first letter, so a reason
 * nobody has written a sentence for yet is still readable prose rather than a
 * raw database slug — `"refunded_and_left"` becomes `"Refunded and left"`.
 * This is the fallback of last resort: every reason known to exist today (see
 * this file's header) has its own line in `KNOWN_REASONS` and never reaches
 * this function.
 */
function humanize(reason: string): string {
  const spaced = reason.replace(/_/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The one sentence a coach sees for why a sequence run ended the way it did.
 *
 * `null` in, `null` out — a run with no exit reason (still running, or ended
 * by reaching `completed` rather than `exited`) has nothing to say here, and
 * both callers already gate rendering on the raw value being present.
 */
export function exitReasonSentence(reason: string | null): string | null {
  if (reason === null) return null
  return KNOWN_REASONS[reason] ?? humanize(reason)
}
