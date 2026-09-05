// lib/lead-engine/enroll.ts — turns a contact event into sequence
// enrolment. Called once, non-fatally, at the end of `recordContactEvent`
// (lib/db/contacts.ts): the contact record is the thing that matters, and
// enrolment is marketing bolted on afterward. Losing an enrolment is
// recoverable; losing the lead is not.

import { createServiceRoleClient } from "@/lib/supabase"
import type { ContactEventSource } from "@/lib/db/contacts"

function getClient() {
  return createServiceRoleClient()
}

type CandidateSequence = {
  id: string
  trigger_filter: Record<string, unknown> | null
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
 * THE run-creation logic, shared by every enrolment path in this file —
 * triggered (`enrollIfTriggered`, below) and manual (`enrolContactManually`).
 * There is exactly one place that inserts a `sequence_runs` row, so the
 * duplicate-run guard (the `23505` swallow) can never drift between the two
 * callers.
 *
 * A `23505` on `sequence_runs_one_active_per_sequence` (migration 00216)
 * means this contact already has an ACTIVE run of this exact sequence —
 * the correct outcome of a double enrolment, not an error. Returns
 * `{ enrolled: false }` rather than throwing; every other insert error
 * propagates.
 */
async function insertSequenceRun(args: {
  supabase: ReturnType<typeof createServiceRoleClient>
  businessId: string
  sequenceId: string
  contactId: string
}): Promise<{ enrolled: boolean }> {
  const { error } = await args.supabase.from("sequence_runs").insert({
    business_id: args.businessId,
    sequence_id: args.sequenceId,
    contact_id: args.contactId,
    current_position: 0,
    next_run_at: new Date().toISOString(),
  })

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

  const { data, error } = await supabase
    .from("sequences")
    .select("id, trigger_filter")
    .eq("business_id", businessId)
    .eq("status", "active")
    .eq("trigger_source", args.source)
  if (error) throw error

  const candidates = (data ?? []) as CandidateSequence[]
  const enrolled: string[] = []

  for (const sequence of candidates) {
    if (!filterMatches(sequence.trigger_filter, metadata)) continue

    const { enrolled: didEnrol } = await insertSequenceRun({
      supabase,
      businessId,
      sequenceId: sequence.id,
      contactId: args.contactId,
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
  })

  return enrolled ? { outcome: "enrolled" } : { outcome: "already_enrolled" }
}
