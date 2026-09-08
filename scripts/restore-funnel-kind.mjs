/**
 * Move ONE row between the Landing pages board and the Funnels board.
 *
 *   node scripts/restore-funnel-kind.mjs .env.prod return-to-sport-assessment --to page
 *   node scripts/restore-funnel-kind.mjs .env.prod return-to-sport-assessment --to page --apply
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A BUTTON
 * ---------------------------------------------------------------------------
 * It is not an oversight that the product cannot do this. On 2026-08-31 the
 * owner ruled that landing pages and funnels are separate things which never
 * turn into each other ("THERE IS NO SUCH THING AS CONVERT"), so
 * `ConvertToFunnelDialog` was deleted and `PATCH /api/admin/funnels/:id` now
 * 400s any body naming `kind` — checked on the RAW body, because Zod would
 * strip the field and answer 200 for a conversion that never happened.
 *
 * That ruling is about the SURFACE. It does not mean a row can never be put
 * back after a conversion made before the ruling; it means putting it back is
 * a deliberate, recorded operation a human runs, not a control sitting on a
 * card waiting to be clicked. This file is the recorded operation. Adding the
 * button back instead would be reversing the owner's decision, not serving it.
 *
 * The precedent is the same flip in the other direction: the prod Athlete Quiz
 * was moved page -> funnel by direct SQL on 2026-08-31 with a hand-written
 * `audit_logs` row. This writes the same row, from the same shape, so the two
 * operations read identically in `/admin/audit-logs`.
 *
 * ---------------------------------------------------------------------------
 * THE ONE GUARD THAT MATTERS: A LANDING PAGE IS ONE PAGE
 * ---------------------------------------------------------------------------
 * `kind` is not decoration. `/admin/pages` renders a row as a single card and
 * a landing page HAS NO DETAIL SCREEN — `/admin/pages/<id>` redirects to the
 * list, because a landing page is one step by definition. So demoting a funnel
 * that has five steps does not lose data, it HIDES four pages behind a board
 * with nowhere to show them, and the owner meets it as "my funnel deleted my
 * pages". Refused below, out loud, rather than left to be discovered.
 *
 * Promoting page -> funnel has no such hazard (one step is a legal funnel), so
 * that direction is unguarded.
 *
 * Nothing else keys off `kind`. Connections are derived from the step
 * documents, not stored; `/go/<slug>` serves both kinds through the same
 * renderer and gates on `funnels.status`, which this never touches. The step
 * rows, their drafts, their published versions and their builder history are
 * all keyed by `funnel_id` / `step_id` and are not read here at all.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

// Hand-rolled rather than clever: `--to` takes a value, so a filter-based split
// of flags from positionals reads that value as the slug. One pass, no guessing.
const args = process.argv.slice(2)
const positional = []
let target = "page"
let apply = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") apply = true
  else if (args[i] === "--to") target = args[++i]
  else if (args[i].startsWith("--")) {
    console.error(`unknown flag ${args[i]}`)
    process.exit(1)
  } else positional.push(args[i])
}
const [envPath, funnelSlug] = positional

if (!envPath || !funnelSlug || (target !== "page" && target !== "funnel")) {
  console.error("usage: node scripts/restore-funnel-kind.mjs <env-file> <funnel-slug> [--to page|funnel] [--apply]")
  process.exit(1)
}
const from = target === "page" ? "funnel" : "page"

const env = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`database: ${env.NEXT_PUBLIC_SUPABASE_URL}`)
console.log(`mode:     ${apply ? "APPLY (writes)" : "dry run (reads only)"}`)
console.log("")

const { data: funnel, error: readError } = await sb
  .from("funnels")
  .select("id,slug,name,kind,status,goal,created_at,updated_at")
  .eq("slug", funnelSlug)
  .maybeSingle()

if (readError) {
  console.error("read failed:", readError.message)
  process.exit(1)
}
if (!funnel) {
  console.error(`no funnel with slug ${JSON.stringify(funnelSlug)} in this database`)
  process.exit(1)
}

const { data: steps, error: stepError } = await sb
  .from("funnel_steps")
  .select("id,slug,name,position,is_entry,published_version_id")
  .eq("funnel_id", funnel.id)
  .order("position")

if (stepError) {
  console.error("step read failed:", stepError.message)
  process.exit(1)
}

console.log(`${funnel.name}  (${funnel.id})`)
console.log(`  slug   /go/${funnel.slug}`)
console.log(`  kind   ${funnel.kind}   ->  ${target}`)
console.log(`  status ${funnel.status}`)
console.log(`  steps  ${steps.length}`)
for (const s of steps) {
  const live = s.published_version_id ? "published" : "never published"
  console.log(`    ${s.position}. ${JSON.stringify(s.name)}  /${s.slug}${s.is_entry ? "  (entry)" : ""}  — ${live}`)
}
console.log("")

if (funnel.kind === target) {
  console.log(`Already kind="${target}". Nothing to do.`)
  process.exit(0)
}

// THE GUARD. See the header: a landing page is one page, and the board that
// renders it has nowhere to show a second.
if (target === "page" && steps.length !== 1) {
  console.error(
    `REFUSED: this funnel has ${steps.length} pages. A landing page is one page — ` +
      `/admin/pages renders a single card and has no detail screen, so ${steps.length - 1} ` +
      `page(s) would become unreachable from the admin. Delete or move them first.`,
  )
  process.exit(1)
}

if (!apply) {
  console.log("Dry run — nothing written. Re-run with --apply to make the change.")
  process.exit(0)
}

// CONDITIONAL ON THE CURRENT KIND, so a second run cannot flip a row that
// something else already moved, and a race writes one change rather than two.
const { data: updated, error: writeError } = await sb
  .from("funnels")
  .update({ kind: target })
  .eq("id", funnel.id)
  .eq("kind", from)
  .select("id,slug,kind,status")

if (writeError) {
  console.error("update failed:", writeError.message)
  process.exit(1)
}
if (!updated || updated.length === 0) {
  console.error(`update matched no rows — kind was no longer "${from}". Nothing changed.`)
  process.exit(1)
}

// Mirrors the row written by hand for the Athlete Quiz flip on 2026-08-31, so
// the two operations read identically in /admin/audit-logs.
const { error: auditError } = await sb.from("audit_logs").insert({
  action: "funnel.updated",
  category: "admin_write",
  outcome: "success",
  actor_email: "darren@darrenjpaul.com",
  actor_role: "admin",
  target_type: "funnel",
  target_id: funnel.id,
  target_label: funnel.name,
  metadata: {
    kind: { from, to: target },
    applied_via: "scripts/restore-funnel-kind.mjs on owner instruction",
  },
})

if (auditError) {
  // The row moved; only its record failed. Say so rather than implying the
  // whole operation failed and inviting a re-run that would find nothing.
  console.error(`kind updated, but the audit row FAILED: ${auditError.message}`)
  process.exit(1)
}

console.log(`Done. ${funnel.name} is now kind="${updated[0].kind}" (status ${updated[0].status}).`)
console.log(`Undo:  node scripts/restore-funnel-kind.mjs ${envPath} ${funnel.slug} --to ${from} --apply`)
