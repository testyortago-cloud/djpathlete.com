// lib/db/contact-sequence-status.ts — one sequence run per contact, for a LIST.
//
// A separate file from lib/db/sequences.ts for the same reason
// lib/db/contacts-list.ts is separate from lib/db/contacts.ts: that file is
// the RUNNER's view of a run — claim it, advance it, defer it, exit it — and
// this one answers a display question about many people at once. Mixing them
// would put a page's read next to the tick's write path.
//
// KEYED ON THE IDS THAT CAME BACK, exactly like `tagsForContacts`: the page
// lists its contacts first, then asks this for the hundred it is about to
// render. One round trip for the page, never one per row, and nothing is read
// for people who are not on screen.
//
// WHICH RUN SPEAKS FOR A PERSON WHO HAS SEVERAL. The column answers "what is
// happening with this person's follow-up NOW", so:
//
//   1. an ACTIVE run wins outright — they are being messaged today, and that
//      outranks any ending, however recent;
//   2. otherwise the most recently ENROLLED run wins;
//   3. a dead-exact timestamp tie falls back to a fixed status order;
//   4. and an exact tie on THAT falls back to the run id.
//
// Rules 3 and 4 are about DETERMINISM, not meaning. Two runs created in one
// transaction share a byte-identical `now()`, and this read has no `.order()`,
// so without a total ordering the winner is PostgREST's unspecified row order —
// which is a badge that can name a different sequence on every refresh. Rule 4
// is what makes the ordering total; the id is arbitrary but stable, which is
// the only property being asked of it.
//
// The ledger row that asked for this column wrote the rule as "active beats
// exited beats completed". Rule 2 is a deliberate departure: a fixed status
// order would show a January opt-out above a March completion, reporting a
// state the person left eight months ago. Status order survives only as a
// tie-break.

import { createServiceRoleClient } from "@/lib/supabase"
import type { LatestSequenceRun } from "@/lib/lead-engine/sequence-status"

function getClient() {
  return createServiceRoleClient()
}

/**
 * PostgREST's own cap, which it applies by TRUNCATING rather than erroring —
 * the same number and the same reason `lib/db/contacts-list.ts` pages.
 */
const RUN_PAGE = 1000

/** Only ever reached by two runs enrolled at the same instant. Lower sorts first. */
const STATUS_TIE_BREAK: Record<string, number> = { active: 0, exited: 1, failed: 2, completed: 3 }

function tieBreak(status: string): number {
  return STATUS_TIE_BREAK[status] ?? 4
}

interface RawRun {
  id: string
  contact_id: string
  sequence_id: string
  status: string
  exit_reason: string | null
  current_position: number
  enrolled_at: string
  sequences: { name?: string } | null
}

/**
 * Newest first, with an active run ahead of everything. See the header.
 *
 * TOTAL, and it has to be. Two runs created in one transaction share a
 * byte-identical `now()`, and the read has no `.order()`, so rank plus
 * timestamp alone leaves the winner to PostgREST's unspecified row order —
 * which is a badge that can name a different sequence on every refresh. `id` is
 * the last tie-break for that reason: arbitrary, but STABLE, which is the only
 * property being asked of it.
 */
function beats(candidate: RawRun, incumbent: RawRun): boolean {
  const candidateActive = candidate.status === "active"
  const incumbentActive = incumbent.status === "active"
  if (candidateActive !== incumbentActive) return candidateActive

  if (candidate.enrolled_at !== incumbent.enrolled_at) return candidate.enrolled_at > incumbent.enrolled_at
  if (tieBreak(candidate.status) !== tieBreak(incumbent.status)) {
    return tieBreak(candidate.status) < tieBreak(incumbent.status)
  }
  return candidate.id < incumbent.id
}

/**
 * The step kinds that actually MESSAGE THE PERSON.
 *
 * `wait`, `branch`, `stop` and `tag` are mechanics, and `alert` emails the
 * COACH (G12), not the lead. Counting rows instead of messages is what makes
 * `new_lead_nurture` — eight rows, four messages — read as "of 8" on a badge
 * and invite a coach to expect eight things to arrive.
 *
 * A KIND THIS DOES NOT KNOW COUNTS AS NOT-A-MESSAGE. `sequence_steps.kind` is
 * plain text, so a kind added later would otherwise silently inflate every
 * badge in the column; a new messaging kind is a deliberate addition that
 * should come here with it.
 */
const MESSAGE_KINDS = new Set(["email", "sms"])

/**
 * Where each of these sequences' messages sit in its order.
 *
 * POSITIONS, NOT A COUNT, because the badge says how many have already gone —
 * which needs to know which ones are behind the run's current position, not
 * merely how many exist.
 *
 * DEGRADES RATHER THAN THROWS, and it is the only read here that does. It
 * feeds the "2 of 4 sent" half of the label and nothing else, so losing it
 * costs a decoration — while throwing would replace a working Follow-up column
 * with the admin error boundary over one. The run read is the opposite
 * contract: an empty column there would read as "nobody is in a follow-up",
 * which is a claim, not a missing ornament.
 */
async function messagePositions(sequenceIds: string[]): Promise<Map<string, number[]>> {
  const positions = new Map<string, number[]>()
  if (sequenceIds.length === 0) return positions

  const { data, error } = await getClient()
    .from("sequence_steps")
    .select("sequence_id, position, kind")
    .in("sequence_id", sequenceIds)
  if (error) {
    console.warn(`latestRunsForContacts: step positions unavailable (${error.code}: ${error.message})`)
    return positions
  }
  for (const row of (data ?? []) as { sequence_id: string; position: number; kind: string }[]) {
    if (!MESSAGE_KINDS.has(row.kind)) continue
    const existing = positions.get(row.sequence_id)
    if (existing) existing.push(row.position)
    else positions.set(row.sequence_id, [row.position])
  }
  return positions
}

/**
 * The same status, for a surface whose rows are NOT contacts.
 *
 * THE FUNNEL LEADS BOARD HAS NO CONTACT ID TO KEY ON. `funnel_submissions`
 * carries `id, funnel_id, step_id, form_key, email, name, phone, payload,
 * attribution_session_id, ip_address, user_agent, lead_user_id, created_at,
 * status, notes, status_changed_at, kind, quiz_attempt_id` — read off
 * production, not off a migration — and neither `contact_id` nor `business_id`
 * is among them. So the ledger row that asked for this column "by contact id"
 * asked for a join that does not exist.
 *
 * Matched on EMAIL instead, which is what this subsystem has. Three things
 * that makes true, all of them deliberate:
 *
 *   * it is an IDENTIFIER MATCH, not a stored link, so it is exactly as good
 *     as the address on the submission. A person who later changed their email
 *     matches nothing and shows "—";
 *   * a PHONE-ONLY submission shows "—", because `contacts.phone_e164` is
 *     E.164 and `funnel_submissions.phone` is whatever was typed into a form.
 *     Normalising one to the other here would be a second, worse copy of
 *     `lib/phone.ts`'s job on a display path;
 *   * UNDER-REPORTING IS THE ONLY FAILURE IT CAN HAVE. Every miss shows "not
 *     in a follow-up", never somebody else's status — the contact read is
 *     scoped to the tenant and matches the address exactly, the same equality
 *     `findContactByIdentifiers` uses.
 *
 * The real fix is `funnel_submissions.contact_id` with a writer on the capture
 * path and a backfill. That is a migration with a reader to name, not a display
 * change, and it belongs with G31 (the funnel subsystem has no `business_id`
 * either).
 *
 * Lowercased before matching because capture stores addresses lowercase — read
 * back on production, where 0 of 170 contacts hold a non-lowercase email.
 */
export async function latestRunsForEmails(
  emails: (string | null | undefined)[],
  businessId: string,
): Promise<Map<string, LatestSequenceRun>> {
  const byEmail = new Map<string, LatestSequenceRun>()
  const wanted = [
    ...new Set(emails.map((email) => email?.trim().toLowerCase() ?? "").filter((email) => email.length > 0)),
  ]
  if (wanted.length === 0) return byEmail

  const { data, error } = await getClient()
    .from("contacts")
    .select("id, email")
    .eq("business_id", businessId)
    .in("email", wanted)
  if (error) throw new Error(`latestRunsForEmails: ${error.message}`)

  const emailByContact = new Map<string, string>()
  for (const row of (data ?? []) as { id: string; email: string | null }[]) {
    if (row.email) emailByContact.set(row.id, row.email.toLowerCase())
  }
  if (emailByContact.size === 0) return byEmail

  const runs = await latestRunsForContacts([...emailByContact.keys()], businessId)
  for (const [contactId, run] of runs) {
    const email = emailByContact.get(contactId)
    if (email) byEmail.set(email, run)
  }
  return byEmail
}

/**
 * Everybody in this business who is CURRENTLY in a follow-up.
 *
 * Feeds the "In a follow-up" filter. It has to be a separate read rather than a
 * predicate on the contact query because the fact lives in `sequence_runs` and
 * PostgREST has no `EXISTS` — so the ids are resolved first and handed to
 * `listContacts` as `restrictToContactIds`.
 *
 * `active` ONLY. Someone whose run ended is not in a follow-up, whatever the
 * ending was, and a filter that included them would return most of the table
 * while claiming to have narrowed it.
 *
 * Throws on a read failure, like every other list read here: an empty filter
 * result and a failed one must not look the same to an operator about to
 * conclude that nobody is being messaged.
 */
export async function contactIdsInSequence(businessId: string): Promise<string[]> {
  const supabase = getClient()
  const ids = new Set<string>()

  // PAGED, BECAUSE POSTGREST SILENTLY CAPS A SELECT AT ~1000 ROWS. Unpaged,
  // the 1001st active run simply would not come back, the filter would hide
  // those people, and the footer — which is narrowed by the same id list —
  // would agree with the truncated set. That is precisely the
  // indistinguishable-from-working failure this file's throw-on-error contract
  // exists to avoid, arriving through the other door.
  for (let from = 0; ; from += RUN_PAGE) {
    const { data, error } = await supabase
      .from("sequence_runs")
      .select("contact_id")
      .eq("business_id", businessId)
      .eq("status", "active")
      .range(from, from + RUN_PAGE - 1)
    if (error) throw new Error(`contactIdsInSequence: ${error.message}`)
    const rows = (data ?? []) as { contact_id: string }[]
    // De-duplicated HERE, unlike the message positions above, and for the
    // opposite reason: this is a set of PEOPLE, and one person with two active
    // runs must appear once — counting rows is what puts the same contact into
    // an `in.()` twice.
    for (const row of rows) ids.add(row.contact_id)
    if (rows.length < RUN_PAGE) break
  }

  // THE REMAINING CEILING, NAMED RATHER THAN HIDDEN. These ids become an
  // `.in("id", ...)` on the contact read, which travels in the query string, so
  // a business with tens of thousands of people mid-follow-up will outgrow the
  // URL long before it outgrows this loop. Nothing truncates silently — the
  // request would fail loudly — and the fix when it arrives is a view or an RPC
  // that expresses "has an active run" as a predicate, not a longer list.
  return [...ids]
}

/**
 * The one run per contact that the Follow-up column speaks for.
 *
 * Returns a Map, which the page turns into a plain object before handing it to
 * a client component — a Map does not survive that boundary.
 *
 * A contact with no run is simply ABSENT from the map rather than present with
 * a null. `describeSequenceStatus(null)` is what turns that into "—", so the
 * two states a reader cares about — "not in a follow-up" and "this column did
 * not load" — stay distinguishable: the second throws.
 */
export async function latestRunsForContacts(
  contactIds: string[],
  businessId: string,
): Promise<Map<string, LatestSequenceRun>> {
  const byContact = new Map<string, LatestSequenceRun>()
  // De-duplicated: the leads board can list two submissions from one person,
  // and the same id twice in an `in.()` is a longer URL for the same answer.
  const wanted = [...new Set(contactIds)]
  if (wanted.length === 0) return byContact

  const { data, error } = await getClient()
    .from("sequence_runs")
    .select("id, contact_id, sequence_id, status, exit_reason, current_position, enrolled_at, sequences(name)")
    .eq("business_id", businessId)
    .in("contact_id", wanted)
  // Throws rather than returning an empty map. "The read failed" and "nobody
  // is in a follow-up" are different answers and only one of them means the
  // operator should stop and look — the same contract `listContacts` keeps.
  if (error) throw new Error(`latestRunsForContacts: ${error.message}`)

  const winners = new Map<string, RawRun>()
  for (const row of (data ?? []) as RawRun[]) {
    const incumbent = winners.get(row.contact_id)
    if (!incumbent || beats(row, incumbent)) winners.set(row.contact_id, row)
  }

  // Only an ACTIVE run renders a step count, so only those sequences are
  // counted. Asking for the rest would be a second round trip for a number
  // nothing on the page reads.
  const activeSequenceIds = [
    ...new Set([...winners.values()].filter((r) => r.status === "active").map((r) => r.sequence_id)),
  ]
  const positions = await messagePositions(activeSequenceIds)

  for (const [contactId, row] of winners) {
    byContact.set(contactId, {
      status: row.status,
      exit_reason: row.exit_reason,
      current_position: row.current_position,
      // The same fallback wording lib/db/contact-detail.ts uses for a run
      // whose sequence row has been deleted, so the two screens agree.
      sequence_name: row.sequences?.name ?? "A sequence that no longer exists",
      messagePositions: positions.get(row.sequence_id) ?? null,
    })
  }
  return byContact
}
