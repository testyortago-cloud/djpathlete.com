/**
 * The GHL contacts import. Reads a snapshot's contacts.json and, per
 * record, calls the Task 7 DAL's `importGhlContact`
 * (lib/lead-engine/import.ts) — record-level idempotent, never enrolls a
 * sequence, existing contacts are enriched rather than duplicated.
 *
 *   npx tsx scripts/import-ghl-contacts.ts <env-file> <snapshot-dir>
 *   npx tsx scripts/import-ghl-contacts.ts <env-file> <snapshot-dir> --execute
 *
 * DRY-RUN IS THE DEFAULT; --execute is the only way to write.
 *
 * WHY DRY-RUN DOESN'T TOUCH A DATABASE (precisely, not "structurally" —
 * the module graph DOES eagerly load `@/lib/supabase` at import time,
 * since `importGhlContact` is imported statically up top; that module just
 * has no top-level side effects of its own today, so loading it costs
 * nothing): the function that actually CREATES a Supabase client
 * (`getClient()` in lib/lead-engine/import.ts) is only ever invoked from
 * inside `importGhlContact`, and `main()` only ever calls
 * `importGhlContact`, reads process.env, or writes import-progress.json
 * from inside `runExecute()` — which itself only runs when `--execute` was
 * passed. Dry-run instead calls `classifyGhlRecord` — the pure half of
 * `importGhlContact`'s own decision, exported from lib/lead-engine/import.ts
 * and shared by both — which reads nothing but the record and the (empty,
 * shipped) email-consent allowlist.
 * Verify this yourself: `grep -n "process.env\|importGhlContact(\|writeFileSync(" scripts/import-ghl-contacts.ts`
 * — every hit is inside `runExecute`. Proven for real, not just argued: the
 * dry-run in task-8-report.md was run pointed at a deliberately
 * NONEXISTENT env-file path and still produced a full report — if it
 * touched the env file or called `getClient()` it would have thrown ENOENT
 * or a connection error instead.
 *
 * HONEST LIMITATION: dry-run reports outcome-CLASS counts
 * (skipped_no_identifier / dnd_suppression / importable), not
 * created-vs-enriched-vs-merged splits. Those depend on what's already in
 * the `contacts` table for this business — state a DB-free classifier
 * cannot see by construction (spelled out on `classifyGhlRecord` itself).
 * Only `--execute` against a real database can report the
 * created/enriched/merged split, because only it actually runs
 * `importGhlContact`.
 *
 * WHY .ts VIA `npx tsx`, NOT .mjs, AND NOT AN ESBUILD --bundle:
 * `classifyGhlRecord` has to live in lib/lead-engine/import.ts — the same
 * file `importGhlContact` lives in — so dry-run classification and
 * execute-time behavior are provably the same rule, never two hand-kept-
 * in-sync copies. That file is TypeScript, and a plain `.mjs` cannot
 * `import` a `.ts` module. scripts/render-lead-engine-emails.ts solves an
 * adjacent problem with an `esbuild --bundle` command in its header, but
 * that script deliberately avoids `@/lib/supabase` (it builds its own
 * Supabase client inline) — bundling THIS module graph does not work the
 * same way: `lib/lead-engine/import.ts` imports `@/lib/supabase`, which
 * imports `next/headers`, and an esbuild bundle run under plain `node`
 * fails to resolve that bare specifier at all (confirmed by trying it —
 * `ERR_MODULE_NOT_FOUND ... Did you mean to import "next/headers.js"?`).
 * ~20 other scripts/*.ts files in this repo already sidestep exactly this
 * by running via `npx tsx` instead of `node` (e.g.
 * scripts/debug-event-capacity.ts, scripts/release-pending-signup.ts) —
 * tsx resolves the `@/*` alias and transpiles TS on the fly through
 * Node's real module resolver, not a bundle, so it does not hit the
 * `next/headers` bundling failure (confirmed by running it: importing
 * `@/lib/lead-engine/import` under `npx tsx` with zero env vars set
 * succeeds). This script follows that established, simpler convention
 * rather than introducing a second one.
 *
 * `tsx` is a pinned `devDependency` in package.json (not relied on via a
 * bare `npx tsx` cache hit) — `npx` will otherwise resolve it from the
 * npm registry (or fail offline) on a machine that has never run it
 * before, which is exactly the machine this script needs to work on at
 * go-live.
 *
 * RESUMABLE: --execute writes import-progress.json inside the snapshot
 * directory (the ghl ids already processed) and skips them on re-run, so
 * a killed or interrupted run picks back up. (`importGhlContact` is also
 * independently idempotent per record — see `alreadyLoggedImport` in
 * lib/lead-engine/import.ts — so a record repeated across runs by mistake
 * still writes nothing twice; the progress file just avoids paying its
 * read-back cost for records already known done.)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  importGhlContact,
  classifyGhlRecord,
  EMAIL_CONSENT_TAG_ALLOWLIST,
  type GhlContactRecord,
  type GhlRecordClassification,
  type ImportOutcome,
} from "@/lib/lead-engine/import"

const SERVICE_APPLICATION_RE = /service.?application/i
const CLASSES = ["skipped_no_identifier", "dnd_suppression", "importable"] as const

// ---------------------------------------------------------------------
// Pure progress-file logic — unit-tested directly in
// __tests__/scripts/import-ghl-contacts.test.ts. No fs, no argv, no DAL.
// ---------------------------------------------------------------------

export type ImportProgress = { doneIds: string[] }

/** `raw` is the file's text, or null if no progress file exists yet (first run). */
export function parseImportProgress(raw: string | null): Set<string> {
  if (raw === null) return new Set()
  const trimmed = raw.trim()
  if (!trimmed) return new Set()
  const parsed = JSON.parse(trimmed) as ImportProgress
  return new Set(parsed.doneIds ?? [])
}

export function isAlreadyImported(doneIds: ReadonlySet<string>, ghlId: string): boolean {
  return doneIds.has(ghlId)
}

export function withRecordDone(doneIds: ReadonlySet<string>, ghlId: string): ImportProgress {
  return { doneIds: [...new Set([...doneIds, ghlId])] }
}

// ---------------------------------------------------------------------
// argv + usage — strict flag check first, house pattern from
// scripts/configure-lead-engine-sms.mjs / scripts/activate-sequence.mjs.
// ---------------------------------------------------------------------

function usageError(): never {
  console.error("usage: npx tsx scripts/import-ghl-contacts.ts <env-file> <snapshot-dir> [--execute]")
  console.error("dry-run is the default and loads no DB client. --execute is the only way to write.")
  process.exit(1)
}

// ---------------------------------------------------------------------
// The service-application check — grep forms.json + form-submissions.json
// for /service.?application/i, printed loudly in BOTH modes. Pure file
// reads off the snapshot dir; no env, no DB, so it runs identically
// regardless of --execute.
// ---------------------------------------------------------------------

function checkServiceApplicationForms(snapshotDir: string): void {
  const formsRaw = readFileSync(path.join(snapshotDir, "forms.json"), "utf8")
  const submissionsRaw = readFileSync(path.join(snapshotDir, "form-submissions.json"), "utf8")
  const formsHit = SERVICE_APPLICATION_RE.test(formsRaw)
  const submissionsHit = SERVICE_APPLICATION_RE.test(submissionsRaw)

  console.log("=".repeat(78))
  console.log("SERVICE-APPLICATION CHECK — grep forms.json + form-submissions.json")
  console.log("(case-insensitive, /service.?application/)")
  if (!formsHit && !submissionsHit) {
    console.log("  RESULT: NO MATCH in either file.")
    console.log("  This export carries no form or submission naming a 'service application'.")
  } else {
    console.log("  RESULT: MATCH FOUND —")
    if (formsHit) console.log("    forms.json matches /service.?application/i")
    if (submissionsHit) console.log("    form-submissions.json matches /service.?application/i")
  }
  console.log("=".repeat(78))
}

// ---------------------------------------------------------------------
// Dry-run: classify every record with the pure classifier. No env read,
// no Supabase import touched, no writeFileSync.
// ---------------------------------------------------------------------

function runDryRun(contacts: GhlContactRecord[]): void {
  const counts: Record<GhlRecordClassification["wouldBe"], number> = {
    skipped_no_identifier: 0,
    dnd_suppression: 0,
    importable: 0,
  }
  const examples: Record<GhlRecordClassification["wouldBe"], GhlContactRecord[]> = {
    skipped_no_identifier: [],
    dnd_suppression: [],
    importable: [],
  }
  let hasPhoneCount = 0
  let consentEvidenceCount = 0

  for (const record of contacts) {
    const classification = classifyGhlRecord(record, EMAIL_CONSENT_TAG_ALLOWLIST)
    counts[classification.wouldBe]++
    if (examples[classification.wouldBe].length < 5) examples[classification.wouldBe].push(record)
    if (classification.hasPhone) hasPhoneCount++
    if (classification.consentEvidence) consentEvidenceCount++
  }

  console.log("")
  console.log(`DRY RUN — ${contacts.length} record(s) classified. No database read, no database write.`)
  console.log("")
  console.log("outcome-CLASS counts:")
  for (const kind of CLASSES) {
    console.log(`  ${kind}: ${counts[kind]}`)
  }
  console.log("")
  console.log(
    `of all ${contacts.length} records: ${hasPhoneCount} carry a usable phone number, ` +
      `${consentEvidenceCount} carry email-consent tag evidence against the shipped allowlist ` +
      `(currently EMPTY — see EMAIL_CONSENT_TAG_ALLOWLIST in lib/lead-engine/import.ts)`,
  )

  for (const kind of CLASSES) {
    console.log("")
    console.log(`-- first ${Math.min(5, examples[kind].length)} "${kind}" example(s) --`)
    if (examples[kind].length === 0) {
      console.log("  (none)")
      continue
    }
    for (const r of examples[kind]) {
      console.log(
        `  id=${r.id} email=${JSON.stringify(r.email)} phone=${JSON.stringify(r.phone)} ` +
          `dnd=${r.dnd} tags=${JSON.stringify(r.tags)}`,
      )
    }
  }

  console.log("")
  console.log("HONEST LIMITATION: the counts above are outcome-CLASS counts (importable / dnd /")
  console.log("skipped), not created-vs-enriched-vs-merged splits. Whether an importable record")
  console.log("becomes 'created' or 'enriched' (and whether it triggers a merge) depends on what")
  console.log("is already in the contacts table for this business — state a DB-free dry-run")
  console.log("cannot see. Only --execute, against a real database, can report that split.")
}

// ---------------------------------------------------------------------
// The --execute loop itself, made unit-testable by taking its two
// effectful dependencies (the per-record importer, the progress-persist
// callback) as injected functions instead of reaching for the real
// importGhlContact / fs.writeFileSync directly — see
// __tests__/scripts/import-ghl-contacts.test.ts.
//
// Error isolation is the load-bearing property here: one poisoned record
// (a malformed row, a transient DB hiccup) must not take down the whole
// run, and must stay retryable on the NEXT run rather than being wrongly
// marked done. Before this, a thrown error inside the loop propagated
// straight out of runExecute, killing the process mid-run — and because
// the poisoned record was never marked done, every identical re-run would
// walk back up to it and die again at the same place, forever. Now a
// per-record failure is caught, recorded (with the ghl id and the error
// message), and the loop moves on; the caller decides how loudly to
// report it and whether to exit non-zero.
// ---------------------------------------------------------------------

export type GhlImportFailure = { ghlId: string; error: string }

export type ProcessGhlRecordsResult = {
  counts: Record<ImportOutcome["kind"], number>
  mergedCount: number
  processedThisRun: number
  skippedAlreadyDone: number
  failures: GhlImportFailure[]
  doneIds: Set<string>
}

export async function processGhlRecords(
  contacts: GhlContactRecord[],
  initialDoneIds: ReadonlySet<string>,
  importOne: (record: GhlContactRecord) => Promise<ImportOutcome>,
  onProgress: (progress: ImportProgress) => void,
): Promise<ProcessGhlRecordsResult> {
  let doneIds = new Set(initialDoneIds)
  const counts: Record<ImportOutcome["kind"], number> = {
    created: 0,
    enriched: 0,
    suppressed_only: 0,
    skipped_no_identifier: 0,
  }
  const failures: GhlImportFailure[] = []
  let mergedCount = 0
  let processedThisRun = 0
  let skippedAlreadyDone = 0

  for (const record of contacts) {
    if (isAlreadyImported(doneIds, record.id)) {
      skippedAlreadyDone++
      continue
    }

    let outcome: ImportOutcome
    try {
      outcome = await importOne(record)
    } catch (err) {
      failures.push({ ghlId: record.id, error: err instanceof Error ? err.message : String(err) })
      // Deliberately NOT marked done: a failure is retryable, and marking
      // it done here would make the next run silently skip a record that
      // was never actually imported.
      continue
    }

    counts[outcome.kind]++
    if (outcome.merged) mergedCount++
    processedThisRun++

    const progress = withRecordDone(doneIds, record.id)
    doneIds = new Set(progress.doneIds)
    // Called after every SUCCESSFUL record, not batched at the end, so a
    // killed run loses at most the one record in flight.
    onProgress(progress)
  }

  return { counts, mergedCount, processedThisRun, skippedAlreadyDone, failures, doneIds }
}

// ---------------------------------------------------------------------
// Execute: read the env file, stream records through importGhlContact,
// persist progress after every record so a killed run is resumable.
// ---------------------------------------------------------------------

async function runExecute(
  envPath: string,
  snapshotDir: string,
  contacts: GhlContactRecord[],
  snapshotTimestamp: string,
): Promise<void> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`env file ${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`)
    process.exit(1)
  }

  // The ONE place in this whole script that touches process.env: importGhlContact's
  // own getClient() (lib/lead-engine/import.ts) reads these two vars directly —
  // there is no parameter to hand it a client instead — and this function only
  // runs when --execute was passed.
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)

  const progressPath = path.join(snapshotDir, "import-progress.json")
  const initialDoneIds = parseImportProgress(existsSync(progressPath) ? readFileSync(progressPath, "utf8") : null)
  console.log(`resuming: ${initialDoneIds.size} record(s) already marked done in ${progressPath}`)

  const result = await processGhlRecords(
    contacts,
    initialDoneIds,
    (record) =>
      importGhlContact(record, {
        snapshotTimestamp,
        emailConsentTagAllowlist: EMAIL_CONSENT_TAG_ALLOWLIST,
      }),
    (progress) => writeFileSync(progressPath, JSON.stringify(progress, null, 2)),
  )

  console.log("")
  console.log(
    `done. processed ${result.processedThisRun} record(s) this run, skipped ${result.skippedAlreadyDone} already-done from a prior run.`,
  )
  for (const kind of ["created", "enriched", "suppressed_only", "skipped_no_identifier"] as const) {
    console.log(`  ${kind}: ${result.counts[kind]}`)
  }
  console.log(`  merges: ${result.mergedCount}`)

  if (result.failures.length > 0) {
    console.log("")
    console.log("=".repeat(78))
    console.log(`FAILED: ${result.failures.length} record(s) errored and were NOT marked done — this run is PARTIAL.`)
    console.log("re-run the same command to retry them; every other record processed this run will be skipped.")
    for (const failure of result.failures) {
      console.log(`  ghl_id=${failure.ghlId} error=${JSON.stringify(failure.error)}`)
    }
    console.log("=".repeat(78))
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)

  // Strict flag check FIRST, before any positional parsing or file read: an
  // unrecognized flag (a typo like "--exceute") must never be silently
  // absorbed as a discarded positional, which would leave `execute` false
  // and let the run be mistaken for a dry-run when it wasn't one asked for
  // — or, worse, the reverse.
  for (const arg of rawArgs) {
    if (arg.startsWith("-") && arg !== "--execute") {
      usageError()
    }
  }

  const execute = rawArgs.includes("--execute")
  const positional = rawArgs.filter((a) => a !== "--execute")

  if (positional.length !== 2) {
    usageError()
  }
  const [envPath, snapshotDir] = positional

  // Mode-agnostic and first: reads only forms.json + form-submissions.json
  // off the snapshot dir, so it prints identically whether or not
  // --execute was passed, before either mode's own work starts.
  checkServiceApplicationForms(snapshotDir)

  const manifest = JSON.parse(readFileSync(path.join(snapshotDir, "MANIFEST.json"), "utf8")) as {
    exportedAt: string
  }
  const contacts = JSON.parse(readFileSync(path.join(snapshotDir, "contacts.json"), "utf8")) as GhlContactRecord[]

  if (!execute) {
    runDryRun(contacts)
    return
  }

  await runExecute(envPath, snapshotDir, contacts, manifest.exportedAt)
}

// Guarded so importing this module (e.g. from a unit test, for the pure
// progress-file functions above) never runs argv parsing or file I/O —
// only running the file directly as the process entry point does.
//
// Compares via `pathToFileURL`, not a hand-built `file://${...}` template
// literal: this repo's checkout path has spaces in it
// ("Darren Paul Projects"), which `import.meta.url` percent-encodes and a
// raw template literal does not — a naive string comparison silently
// never matches on this exact checkout, so `main()` would never run and
// every invocation would exit 0 having done nothing (confirmed by hitting
// this while building the script: the naive form printed nothing at all
// for a bare `--help`-shaped call that should have hit `usageError()`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
