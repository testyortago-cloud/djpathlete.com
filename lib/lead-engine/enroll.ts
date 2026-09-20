// lib/lead-engine/enroll.ts — turns a contact event into sequence
// enrolment. Called once, non-fatally, at the end of `recordContactEvent`
// (lib/db/contacts.ts): the contact record is the thing that matters, and
// enrolment is marketing bolted on afterward. Losing an enrolment is
// recoverable; losing the lead is not.

import { createServiceRoleClient } from "@/lib/supabase"
import type { ContactEventSource } from "@/lib/db/contacts"
import { pickEnrolmentMetadata, type EnrolmentMetadata } from "@/lib/lead-engine/enrolment-metadata"

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
 * Timeline kind written when a trigger is refused by the cooldown, so the
 * refusal shows on the contact's record instead of vanishing. `source` is
 * `sequence_engine`, the same source the tick uses for `sequence_tag_applied`.
 */
export const ENROLMENT_SKIPPED_TIMELINE_KIND = "enrolment_skipped"

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
}): Promise<boolean> {
  const { data, error } = await args.supabase
    .from("sequence_runs")
    .select("id, status, updated_at, completed_at")
    .eq("business_id", args.businessId)
    .eq("sequence_id", args.sequenceId)
    .eq("contact_id", args.contactId)
  if (error) throw error

  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000
  return ((data ?? []) as Array<{ status: string; updated_at?: string | null; completed_at?: string | null }>).some(
    (run) => {
      if (run.status !== "completed" && run.status !== "exited") return false
      // `completed_at` first: it is the moment the run ended. `updated_at`
      // is the fallback because the merge RPC (migrations 00217/00220/00238)
      // exits the lagging run with `updated_at = now()` and no
      // `completed_at` at all — without the fallback a merged-away run would
      // never count, and a plain `updated_at` alone would be wrong for a run
      // touched again after it finished.
      const finishedAt = run.completed_at ?? run.updated_at
      if (!finishedAt) return false
      return new Date(finishedAt).getTime() >= cutoff
    },
  )
}

async function recordEnrolmentSkipped(args: {
  supabase: ReturnType<typeof createServiceRoleClient>
  businessId: string
  contactId: string
  sequence: CandidateSequence
  cooldownDays: number
}): Promise<void> {
  const { error } = await args.supabase.from("contact_timeline_events").insert({
    business_id: args.businessId,
    contact_id: args.contactId,
    kind: ENROLMENT_SKIPPED_TIMELINE_KIND,
    source: "sequence_engine",
    // Key and name ride along so the contact record can say WHICH sequence in
    // words (lib/db/contact-detail.ts) without a second lookup.
    metadata: {
      sequence_id: args.sequence.id,
      sequence_key: args.sequence.key ?? null,
      sequence_name: args.sequence.name ?? null,
      reason: "cooldown",
      cooldown_days: args.cooldownDays,
    },
  })
  if (error) {
    // The refusal itself already happened; losing its note is a reporting
    // gap, not a reason to fail the caller's contact write.
    console.error(
      `enrollIfTriggered: failed to record the cooldown refusal for contact ${args.contactId} (sequence ${args.sequence.id})`,
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
 * no `enrolment_metadata` column yet, naming it would 500 the insert, and
 * `recordContactEvent` treats a failed enrolment as non-fatal — so every
 * lead captured in that window would keep its contact row and silently never
 * start its sequence. Retrying once WITHOUT the key costs that window its
 * metadata and nothing else.
 *
 * WHAT THE RETRY DOES AND DOES NOT PROMISE, stated exactly, because an
 * earlier version of this comment overclaimed and its test could not tell:
 * `isMissingColumnError` reads the CODE only, never which column the message
 * names. So a PGRST204/42703 about some other column is also retried once —
 * harmlessly, because the second insert drops only `enrolment_metadata` and
 * therefore fails identically and throws. What it cannot do is swallow a
 * different fault into a successful write: if the retry succeeds, the
 * payload was right apart from that one key. Matching on the column name
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
}): Promise<{ enrolled: boolean }> {
  const base = {
    business_id: args.businessId,
    sequence_id: args.sequenceId,
    contact_id: args.contactId,
    current_position: 0,
    next_run_at: new Date().toISOString(),
  }

  let { error } = await args.supabase
    .from("sequence_runs")
    .insert({ ...base, enrolment_metadata: args.enrolmentMetadata })

  if (error && isMissingColumnError(error)) {
    // `insertSequenceRun:`, not `enrollIfTriggered:` — this function is also
    // the writer for `enrolContactManually`, and a line produced during a
    // manual enrol would otherwise name a caller that was never involved.
    console.warn(
      "insertSequenceRun: sequence_runs has no enrolment_metadata column yet (migration 00266 pending); enrolling without it",
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
 * Enrols `contactId` into every active sequence whose `trigger_source`
 * matches `source` and whose `trigger_filter` matches `metadata`.
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
  if (error) throw error

  const candidates = (data ?? []) as CandidateSequence[]
  const enrolled: string[] = []

  // G10. Narrowed ONCE, here, so no path below can reach `insertSequenceRun`
  // with the raw bag. On the funnel path that bag is the visitor's entire
  // typed submission (lib/funnels/capture-contact.ts) — see
  // lib/lead-engine/enrolment-metadata.ts for why the key allow-list is the
  // first guard and not the only one.
  const enrolmentMetadata = pickEnrolmentMetadata(metadata)

  for (const sequence of candidates) {
    if (!filterMatches(sequence.trigger_filter, metadata)) continue

    const cooldownDays = sequence.reenrol_cooldown_days ?? DEFAULT_REENROL_COOLDOWN_DAYS
    if (cooldownDays > 0) {
      const finishedRecently = await hasRunFinishedWithin({
        supabase,
        businessId,
        sequenceId: sequence.id,
        contactId: args.contactId,
        days: cooldownDays,
      })
      if (finishedRecently) {
        await recordEnrolmentSkipped({
          supabase,
          businessId,
          contactId: args.contactId,
          sequence,
          cooldownDays,
        })
        continue
      }
    }

    const { enrolled: didEnrol } = await insertSequenceRun({
      supabase,
      businessId,
      sequenceId: sequence.id,
      contactId: args.contactId,
      enrolmentMetadata,
    })
    if (didEnrol) enrolled.push(sequence.id)
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
  })

  return enrolled ? { outcome: "enrolled" } : { outcome: "already_enrolled" }
}
