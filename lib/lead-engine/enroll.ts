// lib/lead-engine/enroll.ts — turns a contact event into sequence
// enrolment. Called once, non-fatally, at the end of `recordContactEvent`
// (lib/db/contacts.ts): the contact record is the thing that matters, and
// enrolment is marketing bolted on afterward. Losing an enrolment is
// recoverable; losing the lead is not.

import { createServiceRoleClient } from "@/lib/supabase"
import type { ContactEventSource } from "@/lib/db/contacts"
import { pickEnrolmentMetadata, type EnrolmentMetadata } from "@/lib/lead-engine/enrolment-metadata"
import { exitRun } from "@/lib/db/sequences"
// G11. The constant only, from the module that WRITES this reason. Importing
// it rather than re-typing the string is what stops the tick and the cooldown
// drifting apart — they are 800 lines and two directories away from each
// other, and a typo here would silently restore the lockout this forgiveness
// exists to prevent. `sequence-tick.ts` is pure (its own header forbids it
// from importing any IO), so this direction adds no cycle and pulls in
// nothing.
import { NOT_ANCHORED_EXIT_REASON } from "@/lib/automation/sequence-tick"

function getClient() {
  return createServiceRoleClient()
}

type CandidateSequence = {
  id: string
  key?: string | null
  name?: string | null
  trigger_filter: Record<string, unknown> | null
  /**
   * `sequences.reenrol_cooldown_days` (migration 00263). Optional in the TYPE
   * because the row is read with `select("*")` below, so a deploy that lands
   * before the migration sees `undefined` here and falls back to the default
   * — the one-deploy tolerance every schema change in this repo has to keep.
   */
  reenrol_cooldown_days?: number | null
}

/**
 * How long a contact must be OUT of a sequence before a trigger may put them
 * back in, when the sequence row carries no value of its own. Mirrors the
 * column default in migration 00263.
 */
export const DEFAULT_REENROL_COOLDOWN_DAYS = 30

/**
 * Timeline kind written when a trigger fires and does NOT start a sequence,
 * so the refusal shows on the contact's record instead of vanishing. Three
 * reasons reach it (`ENROLMENT_SKIP_REASONS`), not just the cooldown it was
 * introduced for. `source` is `sequence_engine`, the same source the tick
 * uses for `sequence_tag_applied`.
 */
export const ENROLMENT_SKIPPED_TIMELINE_KIND = "enrolment_skipped"

/**
 * Why a trigger did not start a sequence. Written to
 * `contact_timeline_events.metadata.reason` on an
 * `ENROLMENT_SKIPPED_TIMELINE_KIND` row, and switched on by
 * `lib/db/contact-detail.ts` to choose the sentence a coach reads. Exported
 * so the two cannot drift into a row the screen has no wording for.
 */
export const ENROLMENT_SKIP_REASONS = {
  /** G01: they finished this same sequence inside its re-enrolment cooldown. */
  cooldown: "cooldown",
  /** G14: they are already partway through a different sequence. */
  alreadyInASequence: "already_in_a_sequence",
  /** G14: a second sequence matched the SAME event; one event, one sequence. */
  alreadyEnrolledThisEvent: "already_enrolled_this_event",
} as const

export type EnrolmentSkipReason = (typeof ENROLMENT_SKIP_REASONS)[keyof typeof ENROLMENT_SKIP_REASONS]

/**
 * G14 — "nobody is in two sequences at once", option B, the owner's decision
 * on 2026-09-20.
 *
 * THE SOURCES THAT MAY INTERRUPT A FOLLOW-UP ALREADY IN FLIGHT. Each one is
 * a direct, deliberate act by the person in the last few seconds — they took
 * the quiz, sent an application, abandoned a checkout, signed up for a camp
 * — so what they just did is more relevant than whatever they were being
 * sent before, and the older run is exited `superseded`.
 *
 * A trigger NOT on this list is refused instead: subscribing to the
 * newsletter or filling a funnel form while already mid-sequence is not a
 * reason to throw away the follow-up they are already receiving.
 *
 * `event_signup` is here on the owner's explicit call and is NOT in the
 * ledger row's own list of three. Without it, someone already in
 * `newsletter_welcome` who signs up for a camp is REFUSED
 * `camp_clinic_deadline` — so they never receive "About the camp you asked
 * about" or any of its deadline reminders, and keep getting newsletter copy
 * instead. That is the one refusal case that leaves a person in the wrong
 * sequence entirely rather than merely missing a nicety.
 *
 * Deliberately NOT here: `lead_magnet`. Its sequence opens with a wait and
 * then "Did the guide answer what you were looking for?" — a follow-up, not
 * the download itself, which is delivered elsewhere. Missing it costs a
 * nudge, not the thing the person asked for. Checked against production
 * rather than assumed.
 *
 * A RECORD OVER THE UNION, not a `Set<string>` — the same trick
 * `IS_PURCHASE_SOURCE` (lib/db/contacts.ts) uses for the same reason. A
 * `Set` catches neither a typo, which would silently never supersede, nor a
 * source added to `ContactEventSource` later, which would quietly default to
 * "refuses". Here, adding one without deciding is a compile error.
 */
export const IS_SUPERSEDING_SOURCE: Record<ContactEventSource, boolean> = {
  quiz: true,
  inquiry: true,
  checkout_abandoned: true,
  event_signup: true,
  // G22. Booking time is the most deliberate act on this list — somebody put a
  // slot in their own diary — so it plainly meets the rule above.
  //
  // UNREACHABLE TODAY, and recorded as such rather than left to look load
  // bearing: no sequence has `trigger_source = 'booking'` (checked against
  // production, not assumed), so a booking capture enrols nobody and there is
  // nothing for it to supersede. The live mechanism by which a booking ends a
  // follow-up is `exitRunsForContact(contactId, "booking", …)` in
  // lib/bookings/ingest.ts, which is stronger: it exits every active run
  // rather than only making way for a new one. This entry is the answer for
  // the day somebody writes a booking-triggered sequence, and the Record type
  // is what forced the question to be asked at all.
  booking: true,

  funnel_form: false,
  funnel_checkout: false,
  contact_form: false,
  newsletter: false,
  lead_magnet: false,
  shop: false,
  assessment: false,
  questionnaire: false,
  step_up: false,
  ai_chat: false,
  purchase: false,
}

/** The same decision as a set, for the places that only need membership. */
export const SUPERSEDING_SOURCES: ReadonlySet<string> = new Set(
  Object.entries(IS_SUPERSEDING_SOURCE)
    .filter(([, supersedes]) => supersedes)
    .map(([source]) => source),
)

/** `sequence_runs.exit_reason` written to the run this trigger replaced. */
export const SUPERSEDED_EXIT_REASON = "superseded"

/**
 * True when this contact has a run of this sequence that COMPLETED or EXITED
 * inside the last `days` days. The partial unique index
 * `sequence_runs_one_active_per_sequence` only ever stops a second ACTIVE
 * run; once a run finishes it drops out of the index, and without this check
 * the next trigger enrols the same person again at once. That is exactly how
 * one account holder went through `abandoned_checkout` twice in four days
 * (16 and 19 Sept 2026): the pack payment-link cron re-fires that trigger
 * every morning. A `failed` run is deliberately NOT counted — a run that
 * died on a configuration fault should not also lock the person out of the
 * repaired sequence.
 *
 * Reads every prior run for (business, sequence, contact) and filters in
 * code, which keeps the query the same shape `enrolContactManually` already
 * uses for its one-per-contact check. A contact has at most a handful.
 */
async function hasRunFinishedWithin(args: {
  supabase: ReturnType<typeof createServiceRoleClient>
  businessId: string
  sequenceId: string
  contactId: string
  days: number
  /**
   * G14. True when the trigger now firing is itself one that supersedes.
   * Decides whether a `superseded` run is forgiven — see the check below.
   */
  triggerSupersedes: boolean
}): Promise<boolean> {
  const { data, error } = await args.supabase
    .from("sequence_runs")
    .select("id, status, exit_reason, updated_at, completed_at")
    .eq("business_id", args.businessId)
    .eq("sequence_id", args.sequenceId)
    .eq("contact_id", args.contactId)
  if (error) throw error

  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000
  return (
    (data ?? []) as Array<{
      status: string
      exit_reason?: string | null
      updated_at?: string | null
      completed_at?: string | null
    }>
  ).some((run) => {
    if (run.status !== "completed" && run.status !== "exited") return false
    // G14, and the same reasoning the `failed` exclusion above already
    // carries: a run that did not end of its OWN accord must not also lock
    // the person out of the sequence. A `superseded` run was cut short by
    // us, because they did something newer — so someone who subscribes,
    // takes the quiz a day later, and subscribes again a week after that
    // would otherwise have asked for the newsletter twice and been refused
    // both times by a run they never opted out of.
    //
    // BUT ONLY FOR A TRIGGER THAT DOES NOT ITSELF SUPERSEDE, or the two
    // rules cancel each other and this function stops braking anything.
    // Without the second half: someone in `abandoned_checkout` takes the
    // quiz (run superseded), abandons another checkout a week later, and is
    // re-enrolled into `abandoned_checkout` from step 1 INSIDE its 30-day
    // window — which is the incident this function was written for, back
    // through a door G14 opened. The forgiving case is a person asking
    // again for something ordinary (the newsletter); the dangerous case is
    // a chaser re-arming itself.
    if (run.exit_reason === SUPERSEDED_EXIT_REASON && !args.triggerSupersedes) return false
    // G11, and the same principle as `failed` above: a run that ended because
    // it could not RUN must not also lock the person out of the repaired one.
    // `not_anchored` means the run met a countdown with no event date behind
    // it — a hand-enrolment, or a run from before migration 00267 — and sent
    // nothing after the step it died on.
    //
    // WITHOUT THIS, the harm is concrete and lands on a real person: a coach
    // hand-enrols a parent into `camp_clinic_deadline` on the 1st, the run
    // ends `not_anchored` the same day, and the parent's ACTUAL camp signup a
    // week later is refused by the 30-day cooldown. They asked for a camp and
    // received no countdown for it, because of a run we ended ourselves.
    //
    // Unconditional, unlike the `superseded` case above, which had to be
    // narrowed to non-superseding triggers so a chaser could not re-arm
    // itself. There is no such loop here: a `not_anchored` run sent nothing
    // and cannot be re-created by the same fault, because the only way to get
    // a second one is a second enrolment that ALSO has no anchor — which
    // ends the same way, harmlessly, having sent nothing.
    if (run.exit_reason === NOT_ANCHORED_EXIT_REASON) return false
    // `completed_at` first: it is the moment the run ended. `updated_at`
    // is the fallback because the merge RPC (migrations 00217/00220/00238)
    // exits the lagging run with `updated_at = now()` and no
    // `completed_at` at all — without the fallback a merged-away run would
    // never count, and a plain `updated_at` alone would be wrong for a run
    // touched again after it finished.
    const finishedAt = run.completed_at ?? run.updated_at
    if (!finishedAt) return false
    return new Date(finishedAt).getTime() >= cutoff
  })
}

async function recordEnrolmentSkipped(args: {
  supabase: ReturnType<typeof createServiceRoleClient>
  businessId: string
  contactId: string
  sequence: CandidateSequence
  reason: EnrolmentSkipReason
  /** Only for `cooldown`. */
  cooldownDays?: number
  /** Only for `already_in_a_sequence` — the run standing in the way. */
  blocking?: { key: string | null; name: string | null }
}): Promise<void> {
  const { error } = await args.supabase.from("contact_timeline_events").insert({
    business_id: args.businessId,
    contact_id: args.contactId,
    kind: ENROLMENT_SKIPPED_TIMELINE_KIND,
    source: "sequence_engine",
    // Key and name ride along so the contact record can say WHICH sequence in
    // words (lib/db/contact-detail.ts) without a second lookup. So does the
    // BLOCKING sequence's, for the same reason: "not started because they are
    // already in something" is only actionable if it says already in what.
    metadata: {
      sequence_id: args.sequence.id,
      sequence_key: args.sequence.key ?? null,
      sequence_name: args.sequence.name ?? null,
      reason: args.reason,
      ...(args.cooldownDays === undefined ? {} : { cooldown_days: args.cooldownDays }),
      ...(args.blocking === undefined
        ? {}
        : { blocking_sequence_key: args.blocking.key, blocking_sequence_name: args.blocking.name }),
    },
  })
  if (error) {
    // The refusal itself already happened; losing its note is a reporting
    // gap, not a reason to fail the caller's contact write.
    console.error(
      `enrollIfTriggered: failed to record the "${args.reason}" refusal for contact ${args.contactId} (sequence ${args.sequence.id})`,
      error,
    )
  }
}

// An empty filter matches everything; a non-empty filter requires every key
// in it to equal the same key in the event metadata. Extra keys present in
// metadata but absent from the filter are irrelevant.
function filterMatches(filter: Record<string, unknown> | null | undefined, metadata: Record<string, unknown>): boolean {
  const entries = Object.entries(filter ?? {})
  if (entries.length === 0) return true
  return entries.every(([key, value]) => metadata[key] === value)
}

/**
 * True when a write was refused because the database does not know a column
 * the payload named. PGRST204 is PostgREST's schema-cache miss on a write;
 * 42703 is Postgres' own `undefined_column` for the versions that surface it
 * directly. Same pair, same reason, as `lib/db/pipeline.ts`'s local copy.
 *
 * Transitional, for ONE deploy: the Vercel build and the migration workflow
 * race on merge to main, so this code runs briefly against a `sequence_runs`
 * that predates 00266. Deliberately kept local rather than exported — a
 * shared helper invites permanent reuse of a temporary tolerance.
 */
function isMissingColumnError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false
  const code = (err as { code?: string }).code
  return code === "PGRST204" || code === "42703"
}

type BlockingSequence = { key: string | null; name: string | null; manualOnly: boolean }

/**
 * G14. What the rule needs to know about the sequences a contact's active
 * runs belong to: whether each may be superseded at all (`manualOnly`), and
 * what to call it in a refusal note.
 *
 * ONE read for both, and the reason they share one is that they are needed
 * at the same moment for the same rows. Reading `trigger_source` lazily on
 * the refusal path would have left the manual-only exemption — which decides
 * whether somebody's compliance ask survives — depending on a query that
 * only runs when a refusal is being written.
 *
 * FAILS OPEN TOWARDS "DO NOT TOUCH IT". An empty map means every active run
 * reads as `manualOnly: false`... which would be the dangerous direction, so
 * a failed read returns a map marking every run manual-only instead: the
 * rule then supersedes nothing and blocks nothing, and the enrolment goes
 * ahead exactly as it did before G14. Losing the rule for one capture is a
 * far smaller harm than exiting a run we could not identify.
 */
async function describeSequences(
  supabase: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  sequenceIds: string[],
): Promise<Map<string, BlockingSequence>> {
  const unique = [...new Set(sequenceIds)]
  const byId = new Map<string, BlockingSequence>()
  if (unique.length === 0) return byId

  try {
    const { data, error } = await supabase
      .from("sequences")
      .select("id, key, name, trigger_source")
      .eq("business_id", businessId)
      .in("id", unique)
    if (error) throw error
    for (const row of (data ?? []) as Array<{
      id: string
      key?: string | null
      name?: string | null
      trigger_source?: string | null
    }>) {
      byId.set(row.id, {
        key: row.key ?? null,
        name: row.name ?? null,
        // `!= null`, so an absent column (a shape this code has not seen)
        // reads as manual-only and is left alone, not superseded.
        manualOnly: row.trigger_source == null,
      })
    }
    // A run whose sequence row did not come back is in the same position.
    for (const id of unique) {
      if (!byId.has(id)) byId.set(id, { key: null, name: null, manualOnly: true })
    }
    return byId
  } catch (err) {
    console.error("describeSequences: could not read the sequences behind this contact's active runs", err)
    for (const id of unique) byId.set(id, { key: null, name: null, manualOnly: true })
    return byId
  }
}

/**
 * G14. Ends the runs a new enrolment replaced, one at a time through
 * `exitRun` — the SAME write every other exit in this codebase goes through,
 * rather than a second copy of "set status, exit_reason, completed_at and
 * release the claim" that could drift from it (the mistake
 * lib/lead-engine/unsubscribe.ts's own header warns about).
 *
 * SWALLOWS AND LOGS, never throws. The new run has already been inserted by
 * the time this runs, and propagating would turn a tidying failure into a
 * lost enrolment: `recordContactEvent` treats a thrown enrolment as
 * non-fatal, so the contact would keep their row and silently receive
 * nothing new.
 *
 * WHAT A FAILURE ACTUALLY COSTS, stated exactly, because an earlier version
 * of this comment had it backwards. The contact is left in two active runs,
 * and `siblingRunDefer` keeps whichever has the EARLIEST `enrolled_at` —
 * which is the old run, the one this rule just decided is no longer the
 * relevant one. So the failure mode is not "the behaviour that shipped
 * before this rule": before, the older run winning was the intended
 * outcome. Here it is the inverse of the decision, and the new sequence the
 * person just asked for is deferred five minutes a tick until the old one
 * finishes. It self-heals when the old run completes; nothing is lost and
 * nobody is sent anything they did not ask for, which is why one
 * best-effort attempt is still the right trade against a lost enrolment.
 */
async function supersedeRuns(args: { runIds: string[]; contactId: string; replacedBy: string }): Promise<void> {
  for (const runId of args.runIds) {
    try {
      await exitRun(runId, SUPERSEDED_EXIT_REASON)
    } catch (err) {
      const pgErr = err as { code?: unknown; message?: unknown } | null | undefined
      console.error(
        `supersedeRuns: could not exit run ${runId} for contact ${args.contactId} after enrolling into sequence ${args.replacedBy}; they are now in two sequences at once`,
        {
          code: typeof pgErr?.code === "string" ? pgErr.code : undefined,
          message: typeof pgErr?.message === "string" ? pgErr.message : undefined,
        },
      )
    }
  }
}

/**
 * THE run-creation logic, shared by every enrolment path in this file —
 * triggered (`enrollIfTriggered`, below) and manual (`enrolContactManually`).
 * There is exactly one place that inserts a `sequence_runs` row, so the
 * duplicate-run guard (the `23505` swallow) can never drift between the two
 * callers — and so `enrolment_metadata` (G10) has exactly one writer.
 *
 * A `23505` on `sequence_runs_one_active_per_sequence` (migration 00216)
 * means this contact already has an ACTIVE run of this exact sequence —
 * the correct outcome of a double enrolment, not an error. Returns
 * `{ enrolled: false }` rather than throwing; every other insert error
 * propagates.
 *
 * `enrolmentMetadata` is what `evaluateBranch`'s `enrolled_metadata_is`
 * predicate later reads. It is ALREADY allow-listed by the caller — this
 * function does not see the raw event bag and must never be given it.
 *
 * THE RETRY IS THE DEPLOY RACE, NOT A GENERAL FALLBACK. On a schema that has
 * no `enrolment_metadata` column (00266) or no `anchor_at` (00267) yet,
 * naming either would 500 the insert, and `recordContactEvent` treats a
 * failed enrolment as non-fatal — so every lead captured in that window would
 * keep its contact row and silently never start its sequence. Retrying once
 * WITHOUT those keys costs that window its metadata and its anchor, and
 * nothing else. An un-anchored run that then meets an anchored wait completes
 * rather than sending, which is the fail-quiet direction.
 *
 * WHAT THE RETRY DOES AND DOES NOT PROMISE, stated exactly, because an
 * earlier version of this comment overclaimed and its test could not tell:
 * `isMissingColumnError` reads the CODE only, never which column the message
 * names. So a PGRST204/42703 about some other column is also retried once —
 * harmlessly, because the second insert drops only the two keys named above
 * and therefore fails identically and throws. What it cannot do is swallow a
 * different fault into a successful write: if the retry succeeds, the
 * payload was right apart from those keys. Matching on the column name
 * instead was considered and rejected — PostgREST's message text is not a
 * stable contract, and keying a guard to it trades a harmless extra attempt
 * for a guard that silently stops working on a PostgREST upgrade.
 * `__tests__/lib/lead-engine/enroll.test.ts` pins the attempt COUNT in both
 * directions, which is the only way this is visible at all.
 */
async function insertSequenceRun(args: {
  supabase: ReturnType<typeof createServiceRoleClient>
  businessId: string
  sequenceId: string
  contactId: string
  enrolmentMetadata: EnrolmentMetadata
  /**
   * G11. `events.start_date` for an event enrolment, which anchored `wait`
   * steps count down to. Null for every sequence that is not a countdown,
   * which is almost all of them.
   */
  anchorAt: string | null
}): Promise<{ enrolled: boolean }> {
  const base = {
    business_id: args.businessId,
    sequence_id: args.sequenceId,
    contact_id: args.contactId,
    current_position: 0,
    next_run_at: new Date().toISOString(),
  }

  // The keys added by migrations the running schema may not have yet. Both
  // are dropped together by the retry below — see the note there.
  //
  // `anchor_at` is OMITTED rather than sent as null when there is no anchor,
  // so that an ordinary enrolment during the deploy window costs no extra
  // round trip. Naming a column that does not exist is what triggers the
  // retry, and the overwhelming majority of enrolments have no anchor.
  const pending: Record<string, unknown> = { enrolment_metadata: args.enrolmentMetadata }
  if (args.anchorAt !== null) pending.anchor_at = args.anchorAt

  let { error } = await args.supabase.from("sequence_runs").insert({ ...base, ...pending })

  if (error && isMissingColumnError(error)) {
    // `insertSequenceRun:`, not `enrollIfTriggered:` — this function is also
    // the writer for `enrolContactManually`, and a line produced during a
    // manual enrol would otherwise name a caller that was never involved.
    //
    // BOTH new keys are dropped, not just the one the error named, and the
    // reason is that 00266 and 00267 can reach a database SEPARATELY. A
    // schema with `enrolment_metadata` but not `anchor_at` is a real
    // intermediate state, and retrying with the other key still present
    // would fail again and throw — turning a tolerated window into lost
    // enrolments, which is the exact harm this retry exists to prevent.
    console.warn(
      "insertSequenceRun: sequence_runs is missing enrolment_metadata and/or anchor_at (migrations 00266/00267 pending); enrolling without them",
    )
    ;({ error } = await args.supabase.from("sequence_runs").insert(base))
  }

  if (error) {
    if ((error as { code?: unknown }).code === "23505") return { enrolled: false }
    throw error
  }

  return { enrolled: true }
}

/**
 * Enrols `contactId` into AT MOST ONE active sequence whose `trigger_source`
 * matches `source` and whose `trigger_filter` matches `metadata`.
 *
 * "AT MOST ONE" IS G14, and it used to read "every". Two rules make it so:
 * one event never enrols twice (`createdHere`), and a contact already
 * partway through another sequence either has that run superseded or is
 * refused, depending on `IS_SUPERSEDING_SOURCE`. Manual-only sequences
 * (`trigger_source IS NULL`) sit outside both — see `preExisting`.
 *
 * `trigger_source` is matched against whatever raw `ContactEventSource`
 * string the caller passes -- the same kind of "one source value decides
 * behaviour" reader `PURCHASE_SOURCES` (lib/db/contacts.ts) exists for. Gap
 * #14 narrowed `purchase`: a `shop_order` or `funnel_purchase` checkout now
 * writes `shop` / `funnel_checkout`, not `purchase`. No sequence is
 * currently keyed on `trigger_source = 'purchase'` (checked against every
 * migration), so this is latent today, not live -- but if one ever is, a
 * shop or funnel buyer will silently stop matching it. Check
 * `PURCHASE_SOURCES` before keying a new sequence on `purchase` alone.
 *
 * A `23505` on `sequence_runs_one_active_per_sequence` means this contact is
 * already in that sequence — the correct outcome of a double submit, not an
 * error. It is swallowed and enrolment continues to the next candidate.
 * Every other insert error, and any error reading `sequences`, propagates:
 * the caller (`recordContactEvent`) is the one that decides this is
 * non-fatal, not this function.
 */
export async function enrollIfTriggered(args: {
  contactId: string
  source: ContactEventSource
  metadata?: Record<string, unknown>
  businessId: string
  /**
   * G11. The fixed moment an anchored `wait` counts down to —
   * `events.start_date` for an event signup. Absent for every other front
   * door, and an un-anchored run simply never meets an anchored step.
   *
   * A SEPARATE TYPED ARGUMENT, NOT A KEY IN `metadata`, and that is a
   * deliberate refusal rather than an oversight. On the funnel path
   * `metadata` is the visitor's ENTIRE typed payload
   * (lib/funnels/capture-contact.ts passes `payload` straight through), and
   * funnel field names are owner-chosen, validated only as
   * `^[a-z][a-z0-9_]{0,39}$`. An owner can name a field `event_start_date`,
   * after which a stranger types the value. This value decides WHEN mail is
   * sent, so it travels where no visitor payload can reach it.
   * `pickEnrolmentMetadata`'s allow-list would have stopped such a key being
   * STORED; it would not have stopped it being USED.
   */
  anchorAt?: string | null
}): Promise<{ enrolled: string[] }> {
  const businessId = args.businessId
  const metadata = args.metadata ?? {}
  const supabase = getClient()

  // `select("*")`, not a column list: `reenrol_cooldown_days` arrives with
  // migration 00263, and this function runs on every lead capture. Naming the
  // column here would make every enrolment throw for the window between the
  // Vercel deploy and the migration applying — see CandidateSequence's note.
  const { data, error } = await supabase
    .from("sequences")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "active")
    .eq("trigger_source", args.source)
    // G14. Arbitrary but STABLE. Nothing gives one sequence priority over
    // another, and since one event now enrols into at most one sequence, the
    // read order decides which — so two identical submissions must not get
    // different follow-ups because Postgres returned the rows the other way
    // round. A real priority column is what would make this meaningful;
    // until there is one, reproducible beats undefined.
    .order("key", { ascending: true })
  if (error) throw error

  const candidates = (data ?? []) as CandidateSequence[]
  const enrolled: string[] = []

  // Nothing matched this source, so nothing below can change the outcome.
  // Returning here keeps the two extra reads G14 adds off every lead capture
  // whose source has no sequence at all (`shop`, `assessment`, `ai_chat`,
  // `purchase`, …) — and, more than a round-trip, keeps their failure paths
  // away from an enrolment that was never going to happen.
  if (candidates.length === 0) return { enrolled: [] }

  // G14. Every run this contact is partway through RIGHT NOW, read once
  // before the loop rather than per candidate.
  //
  // BEST-EFFORT UNDER CONCURRENCY, and it cannot be otherwise here. Two
  // captures for the same contact at the same instant both read this before
  // either inserts, so both pass the blocking check and both enrol — two
  // active runs, and the older one exited twice. No unique index can express
  // "one active run per contact" (the existing partial index is per
  // sequence), and there is no transaction around a contact event. The
  // failure is the pre-G14 state, which `siblingRunDefer` serialises, so it
  // is recorded rather than defended against.
  const { data: activeData, error: activeErr } = await supabase
    .from("sequence_runs")
    .select("id, sequence_id")
    .eq("business_id", businessId)
    .eq("contact_id", args.contactId)
    .eq("status", "active")
  if (activeErr) throw activeErr

  const activeRuns = (activeData ?? []) as Array<{ id: string; sequence_id: string }>

  // The sequences those runs belong to — `trigger_source` to decide whether
  // each may be superseded at all, `key`/`name` for the refusal note. ONE
  // read for both, rather than a second lookup on the refusal path.
  const blockingSequences = await describeSequences(
    supabase,
    businessId,
    activeRuns.map((run) => run.sequence_id),
  )

  /**
   * Runs in flight BEFORE this event that this rule is allowed to touch.
   *
   * A run of a MANUAL-ONLY sequence (`trigger_source IS NULL`) is excluded
   * in BOTH directions: it is never superseded, and it never blocks. The
   * exemption already granted to manual enrolment as a CREATOR is worthless
   * without it — `sms_repermission` is "one ask, then stop" (migration
   * 00223) and `enrolContactManually`'s `onePerContact` counts runs of ANY
   * status, so a quiz submission an hour after a coach ran
   * `scripts/enrol-repermission.ts` would exit the ask, never send it, and
   * make it impossible to create again. Destroying a compliance ask is not
   * something an automatic rule gets to do. The symmetry matters too: were
   * they merely non-supersedable they would block every trigger instead,
   * which is the same feature failing the other way.
   *
   * Two runs remain possible for such a contact; `siblingRunDefer` still
   * serialises them, exactly as it did before this rule existed.
   */
  const preExisting = activeRuns.filter((run) => blockingSequences.get(run.sequence_id)?.manualOnly !== true)

  /** Sequences THIS event matched — never superseded by this same event. */
  const matchedHere = new Set<string>()
  /** Sequences THIS event actually enrolled. */
  const createdHere: string[] = []
  const maySupersede = IS_SUPERSEDING_SOURCE[args.source] === true

  // G10. Narrowed ONCE, here, so no path below can reach `insertSequenceRun`
  // with the raw bag. On the funnel path that bag is the visitor's entire
  // typed submission (lib/funnels/capture-contact.ts) — see
  // lib/lead-engine/enrolment-metadata.ts for why the key allow-list is the
  // first guard and not the only one.
  const enrolmentMetadata = pickEnrolmentMetadata(metadata)

  for (const sequence of candidates) {
    if (!filterMatches(sequence.trigger_filter, metadata)) continue

    // Recorded BEFORE any refusal: this event matched the sequence, so its
    // run is this event's business even if nothing is enrolled into it —
    // see the `blocking` filter below.
    matchedHere.add(sequence.id)

    const cooldownDays = sequence.reenrol_cooldown_days ?? DEFAULT_REENROL_COOLDOWN_DAYS
    if (cooldownDays > 0) {
      const finishedRecently = await hasRunFinishedWithin({
        supabase,
        businessId,
        sequenceId: sequence.id,
        contactId: args.contactId,
        days: cooldownDays,
        triggerSupersedes: maySupersede,
      })
      if (finishedRecently) {
        await recordEnrolmentSkipped({
          supabase,
          businessId,
          contactId: args.contactId,
          sequence,
          reason: ENROLMENT_SKIP_REASONS.cooldown,
          cooldownDays,
        })
        continue
      }
    }

    // ---------------------------------------------------------------------
    // G14 — one sequence at a time.
    //
    // AFTER the cooldown check, deliberately: exiting somebody's live
    // follow-up to make room for a run the cooldown then refuses would leave
    // them receiving nothing at all.
    //
    // A run of THIS sequence is not this rule's business — the partial unique
    // index `sequence_runs_one_active_per_sequence` already refuses that, and
    // superseding a run with another run of the very same sequence would be
    // nonsense.
    // ---------------------------------------------------------------------
    if (createdHere.length > 0) {
      // ONE EVENT ENROLS INTO AT MOST ONE SEQUENCE. The alternative is this
      // event enrolling somebody and then immediately exiting its own
      // enrolment, decided by whichever sequence the read returned first.
      // Latent today (no two active sequences can match a single event on
      // production) — decided here so it can never be decided by accident.
      await recordEnrolmentSkipped({
        supabase,
        businessId,
        contactId: args.contactId,
        sequence,
        reason: ENROLMENT_SKIP_REASONS.alreadyEnrolledThisEvent,
      })
      continue
    }

    // `matchedHere`, not just `sequence.id`: a sequence THIS event matched
    // is never superseded by this same event, even when the enrolment into
    // it was refused — by the unique index (they are already in it), by the
    // cooldown, or by this rule. Without that, a duplicate on candidate one
    // would let candidate two move the person OUT of a sequence the very
    // same event put them in. Ordered by sequence id so the note below
    // blames the same run every time when there is more than one.
    const blocking = preExisting
      .filter((run) => !matchedHere.has(run.sequence_id))
      .sort((a, b) => (a.sequence_id < b.sequence_id ? -1 : a.sequence_id > b.sequence_id ? 1 : 0))

    if (blocking.length > 0 && !maySupersede) {
      await recordEnrolmentSkipped({
        supabase,
        businessId,
        contactId: args.contactId,
        sequence,
        reason: ENROLMENT_SKIP_REASONS.alreadyInASequence,
        // Named from the map read once above. A refusal that cannot say
        // WHICH sequence is in the way gives a coach nothing to act on,
        // which is the whole reason G01 made these refusals name theirs.
        blocking: blockingSequences.get(blocking[0].sequence_id) ?? { key: null, name: null },
      })
      continue
    }

    const { enrolled: didEnrol } = await insertSequenceRun({
      supabase,
      businessId,
      sequenceId: sequence.id,
      contactId: args.contactId,
      enrolmentMetadata,
      // G11. Stamped on EVERY run this capture creates, not only on a
      // sequence that happens to use anchored waits. Nothing here knows which
      // sequences contain one, and a sequence that grows a countdown step
      // later would otherwise find every run enrolled before that edit
      // un-anchored and silently completing.
      anchorAt: args.anchorAt ?? null,
    })
    if (!didEnrol) continue

    enrolled.push(sequence.id)
    createdHere.push(sequence.id)

    // INSERT FIRST, THEN EXIT — never the other way round. If the insert
    // fails after the older run has already been exited, the person is left
    // in nothing at all. This order's worst case is two active runs, which is
    // exactly the behaviour that shipped before this rule and which
    // `siblingRunDefer` still serialises so only one of them sends.
    if (blocking.length > 0) {
      await supersedeRuns({
        runIds: blocking.map((run) => run.id),
        contactId: args.contactId,
        replacedBy: sequence.id,
      })
    }
  }

  return { enrolled }
}

export type ManualEnrolOutcome =
  | { outcome: "enrolled" }
  | { outcome: "already_enrolled" }
  | { outcome: "already_enrolled_once" }
  | { outcome: "sequence_not_found" }
  | { outcome: "sequence_not_active"; status: string }

/**
 * Enrols a single contact into a single sequence BY KEY, on a human's
 * say-so rather than a live trigger event. The manual counterpart to
 * `enrollIfTriggered` — for a sequence whose `trigger_source` is NULL
 * (e.g. `sms_repermission`, migration 00223), this is the ONLY way a
 * `sequence_runs` row is ever created; nothing auto-enrols it.
 *
 * THREE refusals, all load-bearing safety checks, not incidental
 * validation:
 *
 *   1. ACTIVE-SEQUENCE CHECK — a sequence seeded (or left) `draft` refuses
 *      enrolment outright, the same "nothing fires until a human flips the
 *      status" contract migration 00218's header comment states for the
 *      trigger path. `scripts/activate-sequence.mjs` is the one deliberate
 *      way to flip a sequence to `active`; this function does not do that
 *      itself, and does not enrol around a sequence someone left in draft.
 *
 *   2. DUPLICATE-RUN GUARD — reuses `insertSequenceRun`, the exact same
 *      run-creation code `enrollIfTriggered` calls, so a second manual
 *      enrolment of a contact already ACTIVELY running this sequence
 *      no-ops (`already_enrolled`) instead of creating a second row or
 *      throwing. This is `sequence_runs_one_active_per_sequence`'s own
 *      scope — an ACTIVE run only — the same partial unique index
 *      `enrollIfTriggered` relies on.
 *
 *   3. ONE-PER-CONTACT-EVER (opt-in via `onePerContact`, default `false`)
 *      — a check the partial unique index above CANNOT make: that index is
 *      scoped `WHERE status = 'active'`, so once a run COMPLETES or EXITS
 *      it drops out of the index and a plain re-enrolment attempt sails
 *      straight through, silently starting a second run for a contact who
 *      already received (and did not act on) the sequence. For a true
 *      one-shot ask — `sms_repermission` is exactly this: "one ask, then
 *      stop", per migration 00223's own header — that is wrong: a re-run
 *      of `scripts/enrol-repermission.ts` days later must never re-ask
 *      someone who already got the email and didn't reply. Passing
 *      `onePerContact: true` closes that gap by checking for ANY prior
 *      `sequence_runs` row for (contact, sequence), any status at all, and
 *      refusing with `already_enrolled_once` if one exists — BEFORE the
 *      duplicate-run guard even runs, since an exited/completed run would
 *      never trip that guard in the first place.
 *
 *      Left `false` by default because this same function also serves
 *      re-engagement-style sequences where enrolling a contact again after
 *      an earlier run finished is the legitimate, intended behavior (e.g.
 *      `cold_lead_re_engagement`) — a blanket one-per-contact-ever rule
 *      would be wrong there.
 *
 * `sequence_not_found` is distinct from `sequence_not_active` on purpose: a
 * typo'd key and a real, deliberately-draft sequence are different problems
 * for a caller to report.
 */
export async function enrolContactManually(
  contactId: string,
  sequenceKey: string,
  opts: { businessId: string; onePerContact?: boolean },
): Promise<ManualEnrolOutcome> {
  const businessId = opts.businessId
  const onePerContact = opts.onePerContact ?? false
  const supabase = getClient()

  const { data, error } = await supabase
    .from("sequences")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("key", sequenceKey)
    .maybeSingle()
  if (error) throw error
  if (!data) return { outcome: "sequence_not_found" }

  const sequence = data as { id: string; status: string }
  if (sequence.status !== "active") {
    return { outcome: "sequence_not_active", status: sequence.status }
  }

  if (onePerContact) {
    const { data: priorRuns, error: priorErr } = await supabase
      .from("sequence_runs")
      .select("id")
      .eq("business_id", businessId)
      .eq("sequence_id", sequence.id)
      .eq("contact_id", contactId)
    if (priorErr) throw priorErr
    if ((priorRuns ?? []).length > 0) {
      return { outcome: "already_enrolled_once" }
    }
  }

  const { enrolled } = await insertSequenceRun({
    supabase,
    businessId,
    sequenceId: sequence.id,
    contactId,
    // A manual enrolment has no triggering event to remember. `{}` rather
    // than a missing key, matching the column's own default: "this run
    // remembers nothing" and "this run predates the column" must read the
    // same to every branch, which is false.
    enrolmentMetadata: {},
    // G11. A manual enrolment has no event behind it, so there is nothing to
    // anchor to. If the coach picked a countdown sequence, its first anchored
    // wait COMPLETES the run rather than sending — which is the right
    // outcome: "three days to go" before nothing is worse than silence, and
    // the completed run is visible on the contact record. Giving a coach a
    // way to enrol somebody against a chosen event is a real feature, and it
    // belongs with the manual-enrol screen rather than smuggled in here.
    anchorAt: null,
  })

  return enrolled ? { outcome: "enrolled" } : { outcome: "already_enrolled" }
}
