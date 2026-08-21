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
 * `contact_consents`, `contact_suppressions` and `sequence_runs`, none of
 * which exist outside the database. Candidate discovery IS a read, so
 * dry-run here connects with the env file's credentials and runs the same
 * read queries --execute does — what it does NOT do is call
 * `enrolContactManually` or write a `sequence_runs` row for anyone. Verify
 * this yourself: `grep -n "enrolContactManually(" scripts/enrol-repermission.ts`
 * — the only call site is inside `runExecute`, gated the same way
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
 * ELIGIBILITY: a contact qualifies for this ask when it has —
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
 *   4. NEITHER identifier suppressed — email OR phone. This ask itself goes
 *      out over email, so an email-side suppression obviously excludes a
 *      contact (nothing to send to). But a PHONE-side suppression excludes
 *      them too, and for a reason specific to what this sequence asks:
 *      "can we text you?" IS the exact question a prior SMS STOP already
 *      answered. Continuing to press the question by a different channel
 *      just because the identifier that said no wasn't the one this email
 *      happens to use is exactly the appearance of ignoring an opt-out —
 *      the optics this whole ask exists to avoid, not honor by a loophole.
 *      This also matches how suppression works everywhere else in this
 *      codebase: `contact_suppressions` (migration 00215) has no `channel`
 *      column at all — it is identifier-level, full stop — and
 *      `isSuppressed()` (lib/db/contact-consents.ts) never takes a channel
 *      argument either. Checking only the email identifier here would have
 *      been the one place in the Lead Engine treating suppression as
 *      channel-scoped; this script does not carve out that exception.
 *   5. NO existing `sequence_runs` row for `sms_repermission` at all — ANY
 *      status, not just active. See `enrolContactManually`'s
 *      `onePerContact` doc comment (lib/lead-engine/enroll.ts) for why the
 *      ordinary duplicate-run guard alone is not enough for a true one-shot
 *      ask: it only covers ACTIVE runs, so a contact whose earlier run
 *      already COMPLETED (they got the email, the sequence stopped, they
 *      never replied) would otherwise be re-enrollable by a later run of
 *      this exact script — contradicting migration 00223's own "one ask,
 *      then stop" design. This script passes `onePerContact: true` to
 *      `enrolContactManually` as belt-and-braces, but candidate DISCOVERY
 *      also excludes these contacts up front (rather than relying solely on
 *      the enrolment-time refusal) so a dry-run's candidate count is
 *      accurate, not inflated by contacts who would immediately refuse.
 *
 * The eligibility filter (`selectRepermissionCandidates` below) is pure and
 * unit-tested directly — see __tests__/scripts/enrol-repermission.test.ts —
 * against the exact same logic `discoverCandidates` feeds it, the same
 * "dry-run and execute can never disagree about who qualifies" guarantee
 * `classifyGhlRecord` gives the import script.
 *
 * PREFLIGHT: `business_settings.reply_to` is where a "reply YES" actually
 * lands (see migration 00223's header for the whole manual-consent-recording
 * runbook that depends on a human reading that inbox) and `display_name` is
 * required by `renderSequenceEmail`'s `assertSendable` gate at send time. A
 * blank `reply_to` would not error anywhere — the email still sends, replies
 * just go nowhere a human is watching, silently. `main()` checks both before
 * doing anything else: dry-run prints a loud warning and continues (so it
 * still reports candidates, useful for planning); `--execute` refuses
 * outright, exit 1, before enrolling anyone or even running discovery — see
 * `checkBusinessSettingsForRepermission` below, extracted specifically so
 * this check is unit-testable without a database.
 *
 * SAFE TO RE-RUN, PRECISELY: `enrolContactManually`'s ordinary duplicate-run
 * guard (23505 on `sequence_runs_one_active_per_sequence`) makes a second
 * --execute pass a no-op for anyone still ACTIVELY enrolled, and the
 * `onePerContact: true` + discovery-side exclusion above (eligibility #5)
 * additionally makes it a no-op for anyone who has EVER had a run of this
 * sequence, active or finished. Put together: re-running this script only
 * ever enrols contacts who (a) newly became candidates since the last run
 * (e.g. a later import batch) or (b) were somehow skipped by an earlier run
 * that did not reach them (a partial --execute). It will NEVER re-ask a
 * contact this sequence has already reached once — that is the whole point
 * of a one-shot ask, and "safe to re-run" now specifically means "re-run
 * finds only new candidates," not merely "re-run does not crash or double
 * an active run."
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
import { getBusinessSettings } from "@/lib/db/businesses"
import { maskEmail } from "@/lib/lead-engine/mask"

// Re-exported so this script's own call sites below (unchanged) and
// __tests__/scripts/enrol-repermission.test.ts's existing
// `import { maskEmail } from "../../scripts/enrol-repermission"` both keep
// working untouched — `maskEmail` itself now lives in
// lib/lead-engine/mask.ts, shared with scripts/import-ghl-contacts.ts's own
// dry-run masking (that script's is the newer of the two consumers).
export { maskEmail }

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
  phoneE164: string | null
  name: string | null
}

export type RepermissionCandidate = {
  contactId: string
  email: string
  name: string | null
}

/**
 * See this file's header comment (ELIGIBILITY) for the full rationale
 * behind each exclusion. `suppressedEmails` and the email side of
 * `contacts` are compared lowercased, matching how
 * lib/db/contact-consents.ts's `suppress` / `isSuppressed` always lowercase
 * the identifier they write/read; `suppressedPhones` is compared as-is
 * (E.164 phone numbers carry no case).
 */
export function selectRepermissionCandidates(args: {
  contacts: CandidateContactRow[]
  contactIdsWithSmsConsent: ReadonlySet<string>
  contactIdsWithPriorRun: ReadonlySet<string>
  suppressedEmails: ReadonlySet<string>
  suppressedPhones: ReadonlySet<string>
}): RepermissionCandidate[] {
  const out: RepermissionCandidate[] = []
  for (const contact of args.contacts) {
    const email = contact.email?.trim()
    if (!email) continue
    if (args.contactIdsWithSmsConsent.has(contact.id)) continue
    if (args.contactIdsWithPriorRun.has(contact.id)) continue
    if (args.suppressedEmails.has(email.toLowerCase())) continue
    const phone = contact.phoneE164?.trim()
    if (phone && args.suppressedPhones.has(phone)) continue
    out.push({ contactId: contact.id, email, name: contact.name })
  }
  return out
}

// ---------------------------------------------------------------------
// Preflight — pure, unit-tested directly. See this file's header comment
// (PREFLIGHT) for why these two fields specifically.
// ---------------------------------------------------------------------

export type BusinessSettingsPreflightInput = {
  reply_to: string | null | undefined
  display_name: string | null | undefined
}

export type BusinessSettingsPreflightResult = { missing: string[] }

export function checkBusinessSettingsForRepermission(
  settings: BusinessSettingsPreflightInput,
): BusinessSettingsPreflightResult {
  const missing: string[] = []
  if (!settings.reply_to?.trim()) missing.push("reply_to")
  if (!settings.display_name?.trim()) missing.push("display_name")
  return { missing }
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
    .select("id, email, phone_e164, name")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .in("id", candidateContactIds)
  if (contactErr) throw contactErr
  const contacts = (
    (contactRows ?? []) as Array<{ id: string; email: string | null; phone_e164: string | null; name: string | null }>
  ).map((c) => ({ id: c.id, email: c.email, phoneE164: c.phone_e164, name: c.name }) satisfies CandidateContactRow)

  const { data: consentRows, error: consentErr } = await supabase
    .from("contact_consents")
    .select("contact_id")
    .in("contact_id", candidateContactIds)
    .eq("channel", "sms")
  if (consentErr) throw consentErr
  const contactIdsWithSmsConsent = new Set((consentRows ?? []).map((r) => (r as { contact_id: string }).contact_id))

  // Eligibility #5: ANY prior sequence_runs row for sms_repermission, any
  // status. Looked up by the sequence's own id, not by key, because
  // sequence_runs carries sequence_id, not sequence_key. A missing sequence
  // row (migration 00223 not yet applied to this database) means nothing to
  // exclude against — logged, not thrown, since discovery should still be
  // able to report candidates against a database mid-rollout.
  const { data: sequenceRow, error: sequenceErr } = await supabase
    .from("sequences")
    .select("id")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .eq("key", SEQUENCE_KEY)
    .maybeSingle()
  if (sequenceErr) throw sequenceErr
  let contactIdsWithPriorRun = new Set<string>()
  if (sequenceRow) {
    const { data: priorRunRows, error: priorRunErr } = await supabase
      .from("sequence_runs")
      .select("contact_id")
      .eq("business_id", SINGLETON_BUSINESS_ID)
      .eq("sequence_id", (sequenceRow as { id: string }).id)
      .in("contact_id", candidateContactIds)
    if (priorRunErr) throw priorRunErr
    contactIdsWithPriorRun = new Set((priorRunRows ?? []).map((r) => (r as { contact_id: string }).contact_id))
  } else {
    console.warn(
      `no sequence found for key "${SEQUENCE_KEY}" — migration 00223 may not have run yet against this database; ` +
        `skipping the prior-run exclusion (nothing to exclude against)`,
    )
  }

  const candidateEmails = [
    ...new Set(contacts.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e))),
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

  // Eligibility #4's phone half — see this file's header comment for why a
  // suppressed phone excludes a contact from this EMAIL ask too.
  const candidatePhones = [...new Set(contacts.map((c) => c.phoneE164?.trim()).filter((p): p is string => Boolean(p)))]
  let suppressedPhones = new Set<string>()
  if (candidatePhones.length > 0) {
    const { data: phoneSuppressionRows, error: phoneSuppressionErr } = await supabase
      .from("contact_suppressions")
      .select("identifier")
      .eq("business_id", SINGLETON_BUSINESS_ID)
      .in("identifier", candidatePhones)
    if (phoneSuppressionErr) throw phoneSuppressionErr
    suppressedPhones = new Set((phoneSuppressionRows ?? []).map((r) => (r as { identifier: string }).identifier))
  }

  return selectRepermissionCandidates({
    contacts,
    contactIdsWithSmsConsent,
    contactIdsWithPriorRun,
    suppressedEmails,
    suppressedPhones,
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
    already_enrolled_once: 0,
    sequence_not_found: 0,
    sequence_not_active: 0,
  }

  for (const candidate of candidates) {
    // onePerContact: true — belt-and-braces alongside discovery's own
    // eligibility #5 exclusion (this file's header comment). Discovery
    // already filtered out anyone with a prior run; this is what makes that
    // guarantee load-bearing rather than advisory, in case a run started
    // between discovery and this call.
    const outcome = await enrolContactManually(candidate.contactId, SEQUENCE_KEY, { onePerContact: true })
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

  // PREFLIGHT — see this file's header comment. Runs before discovery: a
  // misconfigured business has nothing worth discovering candidates for
  // under --execute.
  const settings = await getBusinessSettings()
  const preflight = checkBusinessSettingsForRepermission(settings)
  if (preflight.missing.length > 0) {
    const fields = preflight.missing.map((f) => `business_settings.${f}`).join(", ")
    if (execute) {
      console.error(
        `refusing to enrol anyone: ${fields} blank. reply_to is where a "reply YES" lands — blank, and every ` +
          `reply routes nowhere a human is watching. display_name is required by renderSequenceEmail's send-time ` +
          `preflight. Fill them first: node scripts/flip-lead-engine-on.mjs <env-file> (fills both from ` +
          `lib/business-info.ts, only if currently empty), then re-run --execute.`,
      )
      process.exit(1)
    } else {
      console.warn("")
      console.warn(
        `[dry-run] WARNING: ${fields} blank. Harmless for a dry-run, but --execute will refuse to enrol anyone ` +
          `until this is fixed — see node scripts/flip-lead-engine-on.mjs <env-file>.`,
      )
    }
  }

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
