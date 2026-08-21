/**
 * The human-run enrolment script for the sms_repermission ask (migration
 * 00223): finds every contact carrying an `sms_repermission_candidate`
 * timeline event (written by scripts/import-ghl-contacts.ts /
 * lib/lead-engine/import.ts for an imported contact whose only evidence of
 * a phone number is a GHL export — never SMS consent) that is still
 * eligible for the ask, and enrols each one into `sms_repermission` via
 * `enrolContactManually` (lib/lead-engine/enroll.ts).
 *
 *   npx tsx scripts/enrol-repermission.ts <env-file>
 *   npx tsx scripts/enrol-repermission.ts <env-file> --execute
 *
 * DRY-RUN IS THE DEFAULT; --execute is the only way to write.
 *
 * UNLIKE scripts/import-ghl-contacts.ts's DRY-RUN, THIS ONE READS THE
 * DATABASE. That script's dry-run is read-free by construction: every
 * record it needs to classify already sits in the snapshot file on disk, so
 * `classifyGhlRecord` never has to ask a database anything. This script has
 * no such file to read from — "which contacts are still eligible for this
 * ask" is a question about the CURRENT state of `contact_timeline_events`,
 * `contact_consents` and `contact_suppressions`, none of which exist
 * outside the database. Candidate discovery IS a read, so dry-run here
 * connects with the env file's credentials and runs the same read queries
 * --execute does — what it does NOT do is call `enrolContactManually` or
 * write a `sequence_runs` row for anyone. Verify this yourself: `grep -n
 * "enrolContactManually(" scripts/enrol-repermission.ts` — the only call
 * site is inside `runExecute`, gated the same way
 * `scripts/import-ghl-contacts.ts` gates its own writes.
 *
 * WHY .ts VIA `npx tsx`, NOT .mjs — same reasoning as
 * scripts/import-ghl-contacts.ts's own header comment, and the same
 * precedent: `enrolContactManually` has to be imported directly from
 * lib/lead-engine/enroll.ts (TypeScript) so this script and the sequence
 * engine's own trigger path (`enrollIfTriggered`, same file) share the
 * exact run-creation code — see that file's `insertSequenceRun` — rather
 * than this script hand-rolling a second copy of the duplicate-run guard
 * that could silently drift from the real one. `tsx` is a pinned
 * `devDependency` in package.json.
 *
 * ELIGIBILITY, per the brief: a contact qualifies for this ask when it
 * has —
 *   1. an `sms_repermission_candidate` timeline event (this business only),
 *   2. an email address on file (this ask goes out over EMAIL — a contact
 *      with a phone but no email has no channel this sequence can reach
 *      them on at all),
 *   3. NO existing row in `contact_consents` for channel `sms` — of EITHER
 *      polarity. A `granted: true` row means they already said yes through
 *      some other path (nothing to ask); a `granted: false` row means they
 *      already said no (an explicit refusal this ask must not talk over).
 *      Re-asking either case would be wrong, so this is a stricter bar than
 *      `hasConsent()` (which only distinguishes "granted"/"not granted" and
 *      collapses "no row" and "a false row" into the same answer) —
 *      exactly why this script queries `contact_consents` directly instead
 *      of reusing that helper.
 *   4. its email is NOT in `contact_suppressions` — checking the EMAIL
 *      identifier specifically, not the phone, because this ask is an
 *      email. A phone-side suppression (e.g. an SMS STOP this contact sent
 *      before ever being asked, however unlikely for a freshly-imported
 *      contact) is a real signal too, but it does not block reaching them
 *      by a channel they have not suppressed.
 *
 * The eligibility filter (`selectRepermissionCandidates` below) is pure and
 * unit-tested directly — see __tests__/scripts/enrol-repermission.test.ts —
 * against the exact same logic `discoverCandidates` feeds it, the same
 * "dry-run and execute can never disagree about who qualifies" guarantee
 * `classifyGhlRecord` gives the import script.
 *
 * SAFE TO RE-RUN: `enrolContactManually`'s duplicate-run guard (23505 on
 * `sequence_runs_one_active_per_sequence`) makes a second --execute pass
 * over the same candidate list a no-op for anyone already enrolled, not a
 * second row or a thrown error.
 *
 * SHIPS LOADED, SAFETY ON: migration 00223 seeds `sms_repermission` as
 * `draft`. Until a human runs
 * `node scripts/activate-sequence.mjs <env-file> sms_repermission`, every
 * --execute enrolment attempt this script makes will come back
 * `sequence_not_active` — printed and counted, not swallowed — and nothing
 * will send. That is intended: this script finding candidates and this
 * sequence being live are two separate deliberate steps.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { enrolContactManually, type ManualEnrolOutcome } from "@/lib/lead-engine/enroll"

const SEQUENCE_KEY = "sms_repermission"
const CANDIDATE_EVENT_KIND = "sms_repermission_candidate"

// ---------------------------------------------------------------------
// argv + usage — strict flag check first, house pattern from
// scripts/import-ghl-contacts.ts / scripts/activate-sequence.mjs /
// scripts/configure-lead-engine-sms.mjs.
// ---------------------------------------------------------------------

function usageError(): never {
  console.error("usage: npx tsx scripts/enrol-repermission.ts <env-file> [--execute]")
  console.error("dry-run is the default and writes nothing. --execute is the only way to enrol anyone.")
  process.exit(1)
}

// ---------------------------------------------------------------------
// Pure eligibility filter — no fs, no argv, no DAL. Unit-tested directly in
// __tests__/scripts/enrol-repermission.test.ts.
// ---------------------------------------------------------------------

export type CandidateContactRow = {
  id: string
  email: string | null
  name: string | null
}

export type RepermissionCandidate = {
  contactId: string
  email: string
  name: string | null
}

/**
 * See this file's header comment for the full eligibility rationale.
 * `suppressedEmails` and the email side of `contacts` are compared
 * lowercased, matching how lib/db/contact-consents.ts's `suppress` /
 * `isSuppressed` always lowercase the identifier they write/read.
 */
export function selectRepermissionCandidates(args: {
  contacts: CandidateContactRow[]
  contactIdsWithSmsConsent: ReadonlySet<string>
  suppressedEmails: ReadonlySet<string>
}): RepermissionCandidate[] {
  const out: RepermissionCandidate[] = []
  for (const contact of args.contacts) {
    const email = contact.email?.trim()
    if (!email) continue
    if (args.contactIdsWithSmsConsent.has(contact.id)) continue
    if (args.suppressedEmails.has(email.toLowerCase())) continue
    out.push({ contactId: contact.id, email, name: contact.name })
  }
  return out
}

/**
 * `m***@d***` — first character of the local part and first character of
 * the domain, everything else replaced. A dry-run transcript prints real
 * candidates' identifiers to a terminal (and potentially a saved log); this
 * is enough to spot-check the query without putting a real email address
 * in that output.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at === -1) return `${email[0] ?? ""}***`
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const maskedLocal = local ? `${local[0]}***` : "***"
  const maskedDomain = domain ? `${domain[0]}***` : "***"
  return `${maskedLocal}@${maskedDomain}`
}

// ---------------------------------------------------------------------
// Discovery — the read side, shared by dry-run and --execute. Reads the
// database (see this file's header on why that is unavoidable here) but
// never writes anything.
// ---------------------------------------------------------------------

async function discoverCandidates(): Promise<RepermissionCandidate[]> {
  const supabase = createServiceRoleClient()

  const { data: timelineRows, error: timelineErr } = await supabase
    .from("contact_timeline_events")
    .select("contact_id")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .eq("kind", CANDIDATE_EVENT_KIND)
  if (timelineErr) throw timelineErr

  const candidateContactIds = [...new Set((timelineRows ?? []).map((r) => (r as { contact_id: string }).contact_id))]
  if (candidateContactIds.length === 0) return []

  const { data: contactRows, error: contactErr } = await supabase
    .from("contacts")
    .select("id, email, name")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .in("id", candidateContactIds)
  if (contactErr) throw contactErr

  const { data: consentRows, error: consentErr } = await supabase
    .from("contact_consents")
    .select("contact_id")
    .in("contact_id", candidateContactIds)
    .eq("channel", "sms")
  if (consentErr) throw consentErr
  const contactIdsWithSmsConsent = new Set((consentRows ?? []).map((r) => (r as { contact_id: string }).contact_id))

  const candidateEmails = [
    ...new Set(
      ((contactRows ?? []) as CandidateContactRow[])
        .map((c) => c.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
  ]
  let suppressedEmails = new Set<string>()
  if (candidateEmails.length > 0) {
    const { data: suppressionRows, error: suppressionErr } = await supabase
      .from("contact_suppressions")
      .select("identifier")
      .eq("business_id", SINGLETON_BUSINESS_ID)
      .in("identifier", candidateEmails)
    if (suppressionErr) throw suppressionErr
    suppressedEmails = new Set((suppressionRows ?? []).map((r) => (r as { identifier: string }).identifier))
  }

  return selectRepermissionCandidates({
    contacts: (contactRows ?? []) as CandidateContactRow[],
    contactIdsWithSmsConsent,
    suppressedEmails,
  })
}

function printCandidateSummary(candidates: RepermissionCandidate[]): void {
  console.log("")
  console.log(`${candidates.length} candidate(s) eligible for the sms_repermission ask.`)
  console.log("")
  console.log(`-- first ${Math.min(5, candidates.length)} candidate(s) --`)
  if (candidates.length === 0) {
    console.log("  (none)")
    return
  }
  for (const c of candidates.slice(0, 5)) {
    console.log(`  id=${c.contactId} email=${maskEmail(c.email)}`)
  }
}

// ---------------------------------------------------------------------
// Execute: enrol every discovered candidate. Nothing here runs in dry-run
// mode — see main().
// ---------------------------------------------------------------------

async function runExecute(candidates: RepermissionCandidate[]): Promise<void> {
  const counts: Record<ManualEnrolOutcome["outcome"], number> = {
    enrolled: 0,
    already_enrolled: 0,
    sequence_not_found: 0,
    sequence_not_active: 0,
  }

  for (const candidate of candidates) {
    const outcome = await enrolContactManually(candidate.contactId, SEQUENCE_KEY)
    counts[outcome.outcome]++
    const detail = outcome.outcome === "sequence_not_active" ? ` (status=${outcome.status})` : ""
    console.log(`  id=${candidate.contactId} email=${maskEmail(candidate.email)} -> ${outcome.outcome}${detail}`)
  }

  console.log("")
  console.log("done. outcome counts:")
  for (const [outcome, count] of Object.entries(counts)) {
    console.log(`  ${outcome}: ${count}`)
  }
  if (counts.sequence_not_active > 0) {
    console.log("")
    console.log(
      `${counts.sequence_not_active} enrolment attempt(s) refused because sequence "${SEQUENCE_KEY}" is not active. ` +
        `Run: node scripts/activate-sequence.mjs <env-file> ${SEQUENCE_KEY}`,
    )
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  // Strict flag check FIRST, before any positional parsing or file read —
  // same rationale as every other script in this house: an unrecognized
  // flag must never be silently absorbed as a discarded positional.
  for (const arg of rawArgs) {
    if (arg.startsWith("-") && arg !== "--execute") {
      usageError()
    }
  }

  const execute = rawArgs.includes("--execute")
  const positional = rawArgs.filter((a) => a !== "--execute")

  if (positional.length !== 1) {
    usageError()
  }
  const [envPath] = positional

  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`env file ${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`)
    process.exit(1)
  }

  // The one place this script touches process.env — createServiceRoleClient
  // (lib/supabase.ts) reads these two vars directly; there is no parameter
  // to hand it a client instead. Set unconditionally: unlike
  // scripts/import-ghl-contacts.ts, THIS script's dry-run also needs a real
  // client (see the header comment on why discovery cannot be read-free
  // here).
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)

  const candidates = await discoverCandidates()
  printCandidateSummary(candidates)

  if (!execute) {
    console.log("")
    console.log("[dry-run] no write performed")
    return
  }

  console.log("")
  console.log(`--execute: enrolling ${candidates.length} candidate(s) into "${SEQUENCE_KEY}"...`)
  await runExecute(candidates)
}

// Guarded so importing this module (e.g. from a unit test, for the pure
// functions above) never runs argv parsing or file I/O — only running the
// file directly as the process entry point does. Compares via
// `pathToFileURL`, not a raw `file://${...}` template literal — same fix
// scripts/import-ghl-contacts.ts already needed for this exact checkout
// path (it has spaces in it, which `import.meta.url` percent-encodes and a
// naive string comparison would silently never match).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
