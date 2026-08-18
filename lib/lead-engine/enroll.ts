// lib/lead-engine/enroll.ts — turns a contact event into sequence
// enrolment. Called once, non-fatally, at the end of `recordContactEvent`
// (lib/db/contacts.ts): the contact record is the thing that matters, and
// enrolment is marketing bolted on afterward. Losing an enrolment is
// recoverable; losing the lead is not.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
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
function filterMatches(
  filter: Record<string, unknown> | null | undefined,
  metadata: Record<string, unknown>,
): boolean {
  const entries = Object.entries(filter ?? {})
  if (entries.length === 0) return true
  return entries.every(([key, value]) => metadata[key] === value)
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
  businessId?: string
}): Promise<{ enrolled: string[] }> {
  const businessId = args.businessId ?? SINGLETON_BUSINESS_ID
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

    const { error: insertError } = await supabase.from("sequence_runs").insert({
      business_id: businessId,
      sequence_id: sequence.id,
      contact_id: args.contactId,
      current_position: 0,
      next_run_at: new Date().toISOString(),
    })

    if (insertError) {
      if ((insertError as { code?: unknown }).code === "23505") continue
      throw insertError
    }

    enrolled.push(sequence.id)
  }

  return { enrolled }
}
