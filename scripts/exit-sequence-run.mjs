/**
 * End ONE sequence run by hand, because a trigger started it for someone it
 * should never have reached.
 *
 * First use (G02 of docs/lead-engine-gaps-to-ship-2026-09-19.md): between 16
 * and 19 Sept 2026 the pack payment-link cron minted a Stripe session every
 * morning for one account holder's unpaid renewal; each expiry looked like an
 * abandoned coaching checkout and enrolled them in `abandoned_checkout`. The
 * webhook no longer does that, but the run it already started is still live
 * and still due to send. This script ends it, optionally removes the tag the
 * sequence applied, and leaves a note on the contact's timeline saying a
 * person did it and why.
 *
 * What it does, in order:
 *
 *   1. Read the run by id, its sequence and its contact. Refuse unless the
 *      run is `active` — completed, exited and failed runs are left alone.
 *   2. Print everything it is about to do. Dry run is the default.
 *   3. With --apply: update the run exactly as `exitRun` would
 *      (lib/db/sequences.ts), guarded on status='active'; delete the named
 *      tag if --remove-tag was given; write one contact_timeline_events row
 *      (`sequence_run_exited_by_hand`) and one audit_logs row
 *      (`sequence.run_exited_by_hand`).
 *   4. Read back and print. A write that was not read back is a claim.
 *
 * NEVER RUN BY A SESSION AGAINST PROD. A human runs this, pointed at
 * .env.prod, and checks the printed host first.
 *
 *   node scripts/exit-sequence-run.mjs --env .env.prod --run <run uuid> \
 *     --reason manual --remove-tag abandoned-checkout \
 *     --note "Renewal payment link, not an abandoned lead."
 *
 *   ... then re-run with --apply once the dry run reads correctly.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { planExit } from "./_exit-sequence-run-lib.mjs"

const KNOWN_FLAGS = new Set(["--env", "--run", "--reason", "--remove-tag", "--note", "--apply"])

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error("usage: node scripts/exit-sequence-run.mjs --env <file> --run <uuid>")
  console.error("         [--reason manual] [--remove-tag <tag>] [--note <text>] [--apply]")
  console.error("Dry run is the default. --apply writes.")
  process.exit(1)
}

function parseArgs(argv) {
  const out = { apply: false, reason: "manual", removeTag: null, note: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    // An unrecognised flag must never be absorbed silently.
    if (!KNOWN_FLAGS.has(flag)) usage(`unrecognised argument: ${flag}`)
    if (flag === "--apply") {
      out.apply = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`)
    i += 1
    if (flag === "--env") out.envFile = value
    if (flag === "--run") out.runId = value
    if (flag === "--reason") out.reason = value
    if (flag === "--remove-tag") out.removeTag = value
    if (flag === "--note") out.note = value
  }
  if (!out.envFile) usage("--env is required")
  if (!out.runId) usage("--run is required")
  if (!/^[0-9a-f-]{36}$/i.test(out.runId)) usage(`--run is not a uuid: ${out.runId}`)
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

function maskEmail(email) {
  if (!email) return "(no email)"
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = readEnv(args.envFile)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) usage(`${args.envFile} has no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY`)

  // Print the host BEFORE anything else: the worst outcome is running
  // against the wrong database while believing otherwise.
  console.log(`host:       ${url}`)
  console.log(`run:        ${args.runId}`)
  console.log(`reason:     ${args.reason}`)
  console.log(`remove tag: ${args.removeTag ?? "(none)"}`)
  console.log(`mode:       ${args.apply ? "APPLY (writes)" : "dry run (no writes)"}`)
  console.log("")

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: run, error: runErr } = await supabase
    .from("sequence_runs")
    .select("id, status, business_id, sequence_id, contact_id, current_position, enrolled_at, next_run_at")
    .eq("id", args.runId)
    .maybeSingle()
  if (runErr) throw runErr

  const now = new Date().toISOString()
  const plan = planExit({ run, reason: args.reason, now })
  if (!plan.ok) {
    if (plan.why === "not_found") usage(`no sequence run with id ${args.runId} on this host`)
    if (plan.why === "not_active") usage(`run ${args.runId} is "${plan.status}", not active — nothing to end`)
    usage("--reason must not be blank")
  }

  const { data: sequence, error: seqErr } = await supabase
    .from("sequences")
    .select("id, key, name")
    .eq("id", run.sequence_id)
    .maybeSingle()
  if (seqErr) throw seqErr

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, email, name")
    .eq("id", run.contact_id)
    .maybeSingle()
  if (contactErr) throw contactErr

  let tagRows = []
  if (args.removeTag) {
    const { data, error } = await supabase
      .from("contact_tags")
      .select("id, tag")
      .eq("business_id", run.business_id)
      .eq("contact_id", run.contact_id)
      .eq("tag", args.removeTag)
    if (error) throw error
    tagRows = data ?? []
  }

  console.log(`sequence:   ${sequence?.key ?? "?"} (${sequence?.name ?? "?"})`)
  console.log(`contact:    ${maskEmail(contact?.email)}${contact?.name ? ` — ${contact.name}` : ""}`)
  console.log(`position:   ${run.current_position}, enrolled ${run.enrolled_at}, next due ${run.next_run_at}`)
  console.log(`will write: ${JSON.stringify(plan.update)}`)
  console.log(`tag rows:   ${args.removeTag ? `${tagRows.length} "${args.removeTag}" row(s) to delete` : "untouched"}`)

  if (!args.apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to end this run.")
    return
  }

  const { data: updated, error: updErr } = await supabase
    .from("sequence_runs")
    .update(plan.update)
    .eq("id", plan.guard.id)
    .eq("status", plan.guard.status)
    .select("id")
  if (updErr) throw updErr
  if (!updated || updated.length === 0) {
    console.log("\nthe run changed underneath this script (no longer active) — nothing written.")
    return
  }

  // From here on the run is ALREADY exited. If any later write throws, say
  // so before dying, so the operator knows the run needs no second pass and
  // exactly which of the note / tag / audit rows to redo by hand.
  let tagRemoved = false
  try {
    if (args.removeTag && tagRows.length > 0) {
      const { error: delErr } = await supabase
        .from("contact_tags")
        .delete()
        .eq("business_id", run.business_id)
        .eq("contact_id", run.contact_id)
        .eq("tag", args.removeTag)
      if (delErr) throw delErr
      tagRemoved = true
    }

    const { error: tlErr } = await supabase.from("contact_timeline_events").insert({
      business_id: run.business_id,
      contact_id: run.contact_id,
      kind: "sequence_run_exited_by_hand",
      source: "repair_script",
      occurred_at: now,
      metadata: {
        run_id: run.id,
        sequence_key: sequence?.key ?? null,
        sequence_name: sequence?.name ?? null,
        reason: plan.update.exit_reason,
        note: args.note,
        tag_removed: tagRemoved ? args.removeTag : null,
      },
    })
    if (tlErr) throw tlErr

    const { error: auditErr } = await supabase.from("audit_logs").insert({
      action: "sequence.run_exited_by_hand",
      category: "admin_write",
      outcome: "success",
      actor_email: "script:exit-sequence-run",
      actor_role: "system",
      target_type: "sequence_run",
      target_id: run.id,
      target_label: sequence?.key ?? null,
      metadata: {
        run_id: run.id,
        sequence_key: sequence?.key ?? null,
        reason: plan.update.exit_reason,
        tag_removed: tagRemoved ? args.removeTag : null,
      },
    })
    if (auditErr) throw auditErr
  } catch (err) {
    console.error(
      `\nthe run ${run.id} IS already exited (that write succeeded). A later write failed — ` +
        `tag removed: ${tagRemoved ? "yes" : "no"}; timeline note and audit row: check audit_logs before redoing them by hand.`,
    )
    throw err
  }

  // Read back. Everything above is a claim until this agrees with it.
  const { data: after, error: afterErr } = await supabase
    .from("sequence_runs")
    .select("id, status, exit_reason, completed_at, claimed_at")
    .eq("id", run.id)
    .maybeSingle()
  if (afterErr) throw afterErr
  const { data: tagsAfter } = args.removeTag
    ? await supabase
        .from("contact_tags")
        .select("id")
        .eq("business_id", run.business_id)
        .eq("contact_id", run.contact_id)
        .eq("tag", args.removeTag)
    : { data: [] }

  console.log("\nread back:")
  console.log(`  run:  ${JSON.stringify(after)}`)
  console.log(
    `  tag:  ${args.removeTag ? `${(tagsAfter ?? []).length} "${args.removeTag}" row(s) remain` : "untouched"}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
