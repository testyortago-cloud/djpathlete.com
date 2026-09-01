/**
 * Repair sequence runs that a CONFIGURATION fault destroyed.
 *
 * On 2026-08-31 the tick ran in production for the first time and failed all
 * 73 `sms_repermission` runs in ten minutes: `business_settings.sender_email`
 * named `noreply@darrenjpaul.com`, and the only domain verified at Resend was
 * `send.darrenjpaul.com`. Every run recorded
 * "sendSequenceEmail failed: The darrenjpaul.com domain is not verified".
 *
 * The runner no longer does this — a configuration fault now defers instead
 * of failing (lib/automation/sequence-tick-runner.ts). But the runs already
 * destroyed cannot recover on their own, and they cannot be re-enrolled
 * either: `enrolContactManually` answers `already_enrolled_once` for a
 * contact whose run exists and is not active, which is correct behaviour
 * protecting people from a double send and must not be weakened for a
 * one-off repair.
 *
 * So this script repairs them directly:
 *
 *   1. Select runs matching ALL THREE predicates (status, sequence, error).
 *   2. DELETE their sequence_messages rows. Deletion rather than a status
 *      change because (run_id, step_id) is uniquely indexed — the dead row is
 *      precisely what would block recordSend from re-claiming. Nothing was
 *      delivered, so no delivery history is lost.
 *   3. Return the runs to active at position 0 with a caller-supplied
 *      next_run_at, guarded on status='failed' so a row that changed
 *      underneath is skipped rather than clobbered.
 *   4. Write one audit_logs row for the batch and one contact_timeline_events
 *      row per contact, so the repair is visible rather than an invisible
 *      hand in the database.
 *   5. Read back and print. A write that was not read back is a claim, not a
 *      result.
 *
 * THERE IS NO DEFAULT FOR --next-run-at, deliberately. Those 73 asks were due
 * 2026-08-22. Whether ten-day-old messages go out as they are or get re-dated
 * is the owner's decision, and a script must not make it by omission.
 *
 * NEVER RUN BY A SESSION AGAINST PROD. A human runs this, pointed at
 * .env.prod. Dry run is the default; --apply is required to write.
 *
 *   node scripts/repair-failed-sequence-runs.mjs --env .env.prod \
 *     --sequence sms_repermission \
 *     --error-pattern "domain is not verified" \
 *     --next-run-at 2026-09-02T12:00:00Z
 *
 *   ... then re-run with --apply once the dry run reads correctly.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { selectRepairable } from "./_repair-failed-sequence-runs-lib.mjs"

const KNOWN_FLAGS = new Set(["--env", "--sequence", "--error-pattern", "--next-run-at", "--apply"])

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error("usage: node scripts/repair-failed-sequence-runs.mjs \\")
  console.error("         --env <env-file> --sequence <key> --error-pattern <text> \\")
  console.error("         --next-run-at <iso8601> [--apply]")
  console.error("")
  console.error("Dry run is the default. --apply writes.")
  process.exit(1)
}

function parseArgs(argv) {
  const out = { apply: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    // An unrecognised flag must never be absorbed silently: "--dryrun" would
    // otherwise leave apply=false looking deliberate, or worse, a mistyped
    // --appply would read as a dry run the operator believes wrote.
    if (!KNOWN_FLAGS.has(flag)) usage(`unrecognised argument: ${flag}`)
    if (flag === "--apply") {
      out.apply = true
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith("--")) usage(`${flag} needs a value`)
    i += 1
    if (flag === "--env") out.envFile = value
    if (flag === "--sequence") out.sequenceKey = value
    if (flag === "--error-pattern") out.errorPattern = value
    if (flag === "--next-run-at") out.nextRunAt = value
  }
  if (!out.envFile) usage("--env is required")
  if (!out.sequenceKey) usage("--sequence is required")
  if (!out.errorPattern) usage("--error-pattern is required")
  if (!out.nextRunAt) usage("--next-run-at is required — see this file's header for why it has no default")
  if (Number.isNaN(Date.parse(out.nextRunAt))) usage(`--next-run-at is not a date: ${out.nextRunAt}`)
  return out
}

function readEnv(file) {
  const text = readFileSync(file, "utf8")
  const env = {}
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
  return env
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = readEnv(args.envFile)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) usage(`${args.envFile} has no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY`)

  // Print the host BEFORE anything else. The single worst outcome here is
  // running against the wrong database while believing otherwise, and the
  // operator's only defence is seeing which one it is.
  console.log(`host:          ${url}`)
  console.log(`sequence:      ${args.sequenceKey}`)
  console.log(`error pattern: ${args.errorPattern}`)
  console.log(`next_run_at:   ${args.nextRunAt}`)
  console.log(`mode:          ${args.apply ? "APPLY (writes)" : "dry run (no writes)"}`)
  console.log("")

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: sequence, error: seqErr } = await supabase
    .from("sequences")
    .select("id, key")
    .eq("key", args.sequenceKey)
    .maybeSingle()
  if (seqErr) throw seqErr
  if (!sequence) usage(`no sequence with key "${args.sequenceKey}" on this host`)

  const { data: rawRuns, error: runsErr } = await supabase
    .from("sequence_runs")
    .select("id, contact_id, status, last_error, current_position, attempts")
    .eq("sequence_id", sequence.id)
    .eq("status", "failed")
  if (runsErr) throw runsErr

  // The predicate is applied in JS, not in the query, so it is the SAME code
  // the test suite exercises. A filter expressed twice is a filter that will
  // eventually disagree with itself.
  const runs = selectRepairable(
    (rawRuns ?? []).map((run) => ({ ...run, sequence_key: sequence.key })),
    { sequenceKey: args.sequenceKey, errorPattern: args.errorPattern },
  )

  console.log(`failed runs on this sequence: ${(rawRuns ?? []).length}`)
  console.log(`matching all three predicates: ${runs.length}`)
  if (runs.length === 0) {
    console.log("\nnothing to repair.")
    return
  }

  if (!args.apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to repair these runs.")
    return
  }

  let repaired = 0
  let skipped = 0
  for (const run of runs) {
    const { error: delErr } = await supabase.from("sequence_messages").delete().eq("run_id", run.id)
    if (delErr) throw delErr

    // Guarded on status='failed': a run that changed underneath this script
    // between the read and the write is skipped, never clobbered.
    const { data: updated, error: updErr } = await supabase
      .from("sequence_runs")
      .update({
        status: "active",
        attempts: 0,
        current_position: 0,
        last_error: null,
        defer_reason: null,
        claimed_at: null,
        claimed_by: null,
        next_run_at: args.nextRunAt,
      })
      .eq("id", run.id)
      .eq("status", "failed")
      .select("id")
    if (updErr) throw updErr
    if (!updated || updated.length === 0) {
      skipped += 1
      continue
    }
    repaired += 1

    const { error: tlErr } = await supabase.from("contact_timeline_events").insert({
      contact_id: run.contact_id,
      kind: "sequence_run_repaired",
      source: "repair_script",
      occurred_at: new Date().toISOString(),
      metadata: {
        run_id: run.id,
        sequence_key: args.sequenceKey,
        reason: "configuration fault: the sending domain was not verified",
        next_run_at: args.nextRunAt,
      },
    })
    if (tlErr) throw tlErr
  }

  const { error: auditErr } = await supabase.from("audit_logs").insert({
    action: "sequence.runs_repaired",
    category: "automation",
    outcome: "success",
    actor_email: "script:repair-failed-sequence-runs",
    actor_role: "system",
    target_type: "sequence",
    target_id: sequence.id,
    target_label: args.sequenceKey,
    metadata: { matched: runs.length, repaired, skipped, next_run_at: args.nextRunAt },
  })
  if (auditErr) throw auditErr

  // Read back. Everything above is a claim until this agrees with it.
  const { data: after, error: afterErr } = await supabase
    .from("sequence_runs")
    .select("status")
    .eq("sequence_id", sequence.id)
  if (afterErr) throw afterErr
  const counts = {}
  for (const row of after ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1

  console.log("")
  console.log(`repaired: ${repaired}`)
  console.log(`skipped (changed underneath): ${skipped}`)
  console.log(`sequence_runs by status now: ${JSON.stringify(counts)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
