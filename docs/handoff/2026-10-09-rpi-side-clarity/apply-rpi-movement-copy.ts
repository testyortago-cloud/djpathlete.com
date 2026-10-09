// One-off, against PRODUCTION. The owner's 2026-10-09 review of the Rotational
// Performance Index: make the three scoring points of each movement test clear,
// and tie them to the four answers. Text only, on the nine movement questions:
//
//   help text  "...then score yourself: a; b; c."  ->  setup, then "1. A" / "2. B" / "3. C"
//   answers    "All three — clean, no compensation"  ->  "3 points — all three, clean, no compensation"
//
// No weight, position, side, prompt or question is touched, so no score or
// past result can change. The new strings come from the seed module, which the
// unit tests run through the quiz gate.
//
//   npx tsx docs/handoff/2026-10-09-rpi-side-clarity/apply-rpi-movement-copy.ts           dry run
//   npx tsx docs/handoff/2026-10-09-rpi-side-clarity/apply-rpi-movement-copy.ts --apply   writes
//
// Every write is a compare-and-set on the text the dry run read, so a row edited
// in between is left alone and reported. A backup of every row it would touch is
// written beside this file before the first write.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { ROTATIONAL_PERFORMANCE_INDEX } from "@/lib/quizzes/seed/rotational-performance-index"

config({ path: "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.env.prod", override: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const apply = process.argv.includes("--apply")

const QUIZ = "8698d925-ae9a-4c8a-873a-9d0696d2544f"
const OLD_LABELS: Record<number, string> = {
  3: "All three — clean, no compensation",
  2: "Two of the three",
  1: "One of the three, or a real struggle",
  0: "I couldn't do it at all",
}

function fail(msg: string): never {
  console.error(`STOP  ${msg}`)
  process.exit(1)
}

interface Row {
  id: string
  report_label: string | null
  side: string | null
  help_text: string | null
  quiz_options: { id: string; label: string; weight: number }[]
}

async function main() {
  if (!url?.includes("supabase.co")) fail(`unexpected URL ${url}`)
  console.log(`Target ${url}  ${apply ? "APPLY" : "dry run"}\n`)

  const { data, error } = await db
    .from("quiz_questions")
    .select("id, report_label, side, help_text, quiz_options(id, label, weight)")
    .eq("quiz_id", QUIZ)
    .not("report_label", "is", null)
  if (error) fail(error.message)
  const rows = data as Row[]
  if (rows.length !== 9) fail(`expected 9 movement questions, found ${rows.length}`)

  const plan: { row: Row; helpText: string; labels: { id: string; from: string; to: string }[] }[] = []
  for (const row of rows) {
    const seed = ROTATIONAL_PERFORMANCE_INDEX.questions.find(
      (q) => q.reportLabel === row.report_label && (q.side ?? null) === row.side,
    )
    if (!seed?.helpText) fail(`no seed question for ${row.report_label} / ${row.side}`)
    // Only the old one-sentence format is rewritten. Anything else was edited
    // by a person and is theirs.
    if (!row.help_text?.includes("then score yourself:"))
      fail(`${row.report_label} / ${row.side}: help text is not the old format`)
    const labels = row.quiz_options.map((option) => {
      if (OLD_LABELS[option.weight] !== option.label)
        fail(`${row.report_label} / ${row.side}: option "${option.label}" is not an old label`)
      const to =
        seed.options.find((o) => o.weight === option.weight)?.label ??
        fail(`no seed option for weight ${option.weight}`)
      return { id: option.id, from: option.label, to }
    })
    if (labels.length !== 4) fail(`${row.report_label} / ${row.side}: ${labels.length} options, expected 4`)
    plan.push({ row, helpText: seed.helpText, labels })
  }

  for (const { row, helpText } of plan) console.log(`${row.report_label} — ${row.side ?? "single"}\n${helpText}\n`)
  console.log("Answers:", plan[0].labels.map((l) => l.to).join(" | "))
  console.log(`\n${plan.length} questions, ${plan.reduce((n, p) => n + p.labels.length, 0)} answers would change.`)
  if (!apply) return console.log("Dry run: nothing written. Re-run with --apply.")

  // Relative to the repo root, which is where the commands above run it from.
  const backupPath = join(
    "docs/handoff/2026-10-09-rpi-side-clarity",
    `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  )
  writeFileSync(backupPath, JSON.stringify(rows, null, 2))
  console.log(`Backup: ${backupPath}`)

  let skipped = 0
  for (const { row, helpText, labels } of plan) {
    const q = await db
      .from("quiz_questions")
      .update({ help_text: helpText })
      .eq("id", row.id)
      .eq("help_text", row.help_text!)
      .select("id")
    if (q.error) fail(q.error.message)
    if (q.data.length !== 1) {
      skipped++
      console.log(`  SKIP  ${row.report_label} / ${row.side}: help text changed since the read`)
    }
    for (const label of labels) {
      const o = await db
        .from("quiz_options")
        .update({ label: label.to })
        .eq("id", label.id)
        .eq("label", label.from)
        .select("id")
      if (o.error) fail(o.error.message)
      if (o.data.length !== 1) {
        skipped++
        console.log(`  SKIP  option ${label.id}: label changed since the read`)
      }
    }
    console.log(`  ok  ${row.report_label} / ${row.side ?? "single"}`)
  }
  console.log(skipped ? `Done with ${skipped} skipped.` : "Done. Nothing skipped.")
}

void main()
