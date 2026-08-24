/**
 * Seeds the reconstructed RPI Athlete Quiz (lib/quizzes/seed/rpi-athlete-quiz.ts)
 * into a database.
 *
 *   npx tsx scripts/seed-athlete-quiz.ts                 # dry run, dev clone
 *   npx tsx scripts/seed-athlete-quiz.ts --execute       # write to the dev clone
 *   npx tsx scripts/seed-athlete-quiz.ts .env.prod --execute --allow-non-clone
 *
 * DRY-RUN IS THE DEFAULT; --execute is the only way to write. Same convention
 * as scripts/enrol-repermission.ts.
 *
 * DEFAULTS TO THE DEV CLONE and refuses any other project unless
 * --allow-non-clone is passed as well. Seeding a quiz into production by
 * fat-fingering an env path is a quiz appearing on Darren's list uninvited.
 *
 * WHY .ts VIA `npx tsx`, NOT .mjs — the plan named this `.mjs`, but the seed
 * it exists to insert is a TypeScript module, and importing it directly is the
 * entire point: a second, hand-copied version of the quiz content in a .mjs
 * file would drift from the one `quizGate` validates in CI, and the drift
 * would be invisible. Same precedent and same reasoning as
 * scripts/enrol-repermission.ts and scripts/import-ghl-contacts.ts. `tsx` is a
 * pinned devDependency.
 *
 * IDEMPOTENT AND ADDITIVE. Re-running never updates and never deletes: a row
 * that already exists is left exactly as it is. That is what makes it safe to
 * re-run after Darren has spent a morning editing copy in the editor — the
 * alternative loses that morning to a careless re-run.
 *
 * ON KEYING. `quizzes`, `quiz_branches`, `quiz_tiers` and `quiz_profiles` each
 * have a stable `key` column with a UNIQUE constraint, so those upsert on it.
 * `quiz_questions` and `quiz_options` HAVE NEITHER — the plan assumed a stable
 * key on every child and the schema does not carry one. They are therefore
 * matched in application code on `(quiz_id, position)` and
 * `(question_id, position)`, which is the identity the seed actually assigns:
 * position is global and meaningful here, not an arbitrary ordinal.
 *
 * Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §6
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { RPI_ATHLETE_QUIZ, SEED_MARKER, toDefinition, type SeedQuiz } from "@/lib/quizzes/seed/rpi-athlete-quiz"
import { quizGate } from "@/lib/quizzes/gate"

const CLONE_REF = "anjvztjiokcgiyhobknq"
const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"

interface Tally {
  inserted: number
  skipped: number
}

const tally = (): Tally => ({ inserted: 0, skipped: 0 })

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const execute = args.includes("--execute")
  const allowNonClone = args.includes("--allow-non-clone")
  const positional = args.filter((a) => !a.startsWith("--"))
  const envPath = positional[0] ?? ".env.local"

  const env = loadEnv(envPath)
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(`env file ${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`)
    process.exit(1)
  }

  const host = new URL(url).host
  const ref = host.split(".")[0]
  console.log(`env file : ${envPath}`)
  console.log(`project  : ${host}${ref === CLONE_REF ? "  (dev clone)" : "  (NOT the dev clone)"}`)
  console.log(`mode     : ${execute ? "EXECUTE (writes)" : "dry run (writes nothing)"}`)

  if (ref !== CLONE_REF && !allowNonClone) {
    console.error("\nREFUSING: this is not the dev clone. Pass --allow-non-clone to seed it anyway.")
    process.exit(1)
  }

  // THE GATE RUNS BEFORE ANYTHING IS WRITTEN. The seed is a typed module
  // precisely so this is possible; a quiz that could not go active has no
  // business being inserted.
  const gate = quizGate(toDefinition(RPI_ATHLETE_QUIZ))
  console.log(`gate     : ${gate.ok ? "ok" : "FAILED"}${gate.warnings.length ? ` (${gate.warnings.length} warning(s))` : ""}`)
  for (const warning of gate.warnings) console.log(`  warn: ${warning}`)
  if (!gate.ok) {
    for (const blocker of gate.blockers) console.error(`  BLOCKER: ${blocker}`)
    process.exit(1)
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })
  await seed(sb, RPI_ATHLETE_QUIZ, execute)
}

async function seed(sb: SupabaseClient, quiz: SeedQuiz, execute: boolean): Promise<void> {
  const counts = { quiz: tally(), branches: tally(), profiles: tally(), tiers: tally(), questions: tally(), options: tally() }

  // ---- the quiz row -------------------------------------------------------
  const { data: existingQuiz, error: quizReadError } = await sb
    .from("quizzes")
    .select("id,key,status,seed_marker")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .eq("key", quiz.key)
    .maybeSingle()
  if (quizReadError) throw new Error(`reading quizzes: ${quizReadError.code} ${quizReadError.message}`)

  let quizId = existingQuiz?.id as string | undefined
  if (quizId) {
    counts.quiz.skipped++
    console.log(`\nquiz "${quiz.key}" already exists (${quizId}) — left untouched`)
  } else if (!execute) {
    counts.quiz.inserted++
    console.log(`\nquiz "${quiz.key}" would be inserted`)
  } else {
    const { data, error } = await sb
      .from("quizzes")
      .insert({
        business_id: SINGLETON_BUSINESS_ID,
        key: quiz.key,
        name: quiz.name,
        status: "draft",
        intro_headline: quiz.introHeadline,
        intro_body: quiz.introBody,
        gate_headline: quiz.gateHeadline,
        gate_body: quiz.gateBody,
        result_headline: quiz.resultHeadline,
        seed_marker: SEED_MARKER,
      })
      .select("id")
      .single()
    if (error) throw new Error(`inserting quiz: ${error.code} ${error.message}`)
    quizId = data.id
    counts.quiz.inserted++
    console.log(`\nquiz "${quiz.key}" inserted (${quizId})`)
  }

  // In a dry run against an empty database there is no quiz id to hang
  // children off. Report what WOULD happen and stop rather than pretending.
  if (!quizId) {
    console.log("\ndry run against a database with no quiz row: child counts cannot be resolved without it.")
    console.log(`would insert: ${quiz.branches.length} branches, ${quiz.profiles.length} profiles, ${quiz.tiers.length} tiers, ${quiz.questions.length} questions, ${quiz.questions.reduce((n, q) => n + q.options.length, 0)} options`)
    return
  }

  const keyed = async (
    table: string,
    rows: Record<string, unknown>[],
    counter: Tally,
  ): Promise<Map<string, string>> => {
    const { data: existing, error } = await sb.from(table).select("id,key").eq("quiz_id", quizId)
    if (error) throw new Error(`reading ${table}: ${error.code} ${error.message}`)
    const byKey = new Map<string, string>((existing ?? []).map((r) => [r.key as string, r.id as string]))
    for (const row of rows) {
      const rowKey = row.key as string
      if (byKey.has(rowKey)) {
        counter.skipped++
        continue
      }
      counter.inserted++
      if (!execute) continue
      const { data, error: insertError } = await sb.from(table).insert({ ...row, quiz_id: quizId }).select("id").single()
      if (insertError) throw new Error(`inserting into ${table} (${rowKey}): ${insertError.code} ${insertError.message}`)
      byKey.set(rowKey, data.id as string)
    }
    return byKey
  }

  const branchIds = await keyed(
    "quiz_branches",
    quiz.branches.map((b) => ({ key: b.key, name: b.name, description: b.description, position: b.position })),
    counts.branches,
  )
  const profileIds = await keyed(
    "quiz_profiles",
    quiz.profiles.map((p) => ({ key: p.key, name: p.name, description: p.description, position: p.position })),
    counts.profiles,
  )
  await keyed(
    "quiz_tiers",
    quiz.tiers.map((t) => ({
      key: t.key,
      position: t.position,
      min_score: t.minScore,
      max_score: t.maxScore,
      headline: t.headline,
      body: t.body,
    })),
    counts.tiers,
  )

  // ---- questions and options, matched on position -------------------------
  const { data: existingQuestions, error: questionReadError } = await sb
    .from("quiz_questions")
    .select("id,position,branch_id")
    .eq("quiz_id", quizId)
  if (questionReadError) throw new Error(`reading quiz_questions: ${questionReadError.code} ${questionReadError.message}`)

  // Identity is (branch_id, position): position repeats ACROSS branches by
  // design — each branch's own questions start again at 50 — so position
  // alone would collapse four different questions into one.
  const questionKey = (branchId: string | null, position: number) => `${branchId ?? "-"}@${position}`
  const byPosition = new Map<string, string>(
    (existingQuestions ?? []).map((q) => [questionKey(q.branch_id as string | null, q.position as number), q.id as string]),
  )

  for (const question of quiz.questions) {
    const branchId = question.branch ? branchIds.get(question.branch) ?? null : null
    if (question.branch && !branchId && execute) {
      throw new Error(`question ${question.key} names branch "${question.branch}", which was not inserted`)
    }
    const identity = questionKey(branchId, question.position)
    let questionId = byPosition.get(identity)

    if (questionId) {
      counts.questions.skipped++
    } else {
      counts.questions.inserted++
      if (execute) {
        const { data, error } = await sb
          .from("quiz_questions")
          .insert({
            quiz_id: quizId,
            branch_id: branchId,
            position: question.position,
            prompt: question.prompt,
            is_active: true,
          })
          .select("id")
          .single()
        if (error) throw new Error(`inserting question ${question.key}: ${error.code} ${error.message}`)
        questionId = data.id as string
        byPosition.set(identity, questionId)
      }
    }

    if (!questionId) {
      // Dry run, question not yet present: its options would all be new.
      counts.options.inserted += question.options.length
      continue
    }

    const { data: existingOptions, error: optionReadError } = await sb
      .from("quiz_options")
      .select("id,position")
      .eq("question_id", questionId)
    if (optionReadError) throw new Error(`reading quiz_options: ${optionReadError.code} ${optionReadError.message}`)
    const takenPositions = new Set((existingOptions ?? []).map((o) => o.position as number))

    for (const [index, option] of question.options.entries()) {
      const position = index + 1
      if (takenPositions.has(position)) {
        counts.options.skipped++
        continue
      }
      counts.options.inserted++
      if (!execute) continue
      const { error } = await sb.from("quiz_options").insert({
        question_id: questionId,
        position,
        label: option.label,
        weight: option.weight,
        routes_to_branch_id: option.routesToBranch ? branchIds.get(option.routesToBranch) ?? null : null,
        profile_id: option.profile ? profileIds.get(option.profile) ?? null : null,
      })
      if (error) throw new Error(`inserting option ${question.key}#${position}: ${error.code} ${error.message}`)
    }
  }

  console.log("")
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(10)} inserted ${String(count.inserted).padStart(3)}   left alone ${String(count.skipped).padStart(3)}`)
  }
  console.log(execute ? "\nDone." : "\nDry run. Nothing was written. Re-run with --execute.")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
