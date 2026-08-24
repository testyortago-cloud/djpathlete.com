// lib/db/quizzes.ts — the IO layer for the quiz engine (migration 00228).
//
// THIS IS THE ONLY FILE THAT TALKS TO THE quiz_* TABLES. Everything above it —
// the scorer, the gate, the public-definition stripper, the routes — works in
// memory and hands finished values to these functions.
//
// FIVE SMALL SELECTS, NOT ONE NESTED EMBED. PostgREST can express
// `quizzes?select=*,quiz_questions(*,quiz_options(*))` in a single round trip,
// and it is deliberately not used: an embed silently returns an empty child
// array when a child table's RLS refuses the read, which is indistinguishable
// from "this quiz has no questions". Every one of these tables is service-role
// only, so a future policy change would turn a scoring bug into a silent
// half-quiz. Separate reads fail loudly instead.
//
// Spec: docs/superpowers/specs/2026-08-23-athlete-quiz-funnel-design.md §1

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { slugify } from "@/lib/funnels/slug"
import type {
  QuizAlertStatus,
  QuizAnswer,
  QuizBranch,
  QuizDefinition,
  QuizOption,
  QuizProfile,
  QuizQuestion,
  QuizStatus,
  QuizTier,
} from "@/lib/quizzes/types"

function getClient() {
  return createServiceRoleClient()
}

type Row = Record<string, unknown>

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0)

function toBranch(row: Row): QuizBranch {
  return {
    id: str(row.id),
    quizId: str(row.quiz_id),
    key: str(row.key),
    name: str(row.name),
    description: strOrNull(row.description),
    position: num(row.position),
  }
}

function toOption(row: Row): QuizOption {
  return {
    id: str(row.id),
    questionId: str(row.question_id),
    position: num(row.position),
    label: str(row.label),
    weight: num(row.weight),
    routesToBranchId: strOrNull(row.routes_to_branch_id),
    profileId: strOrNull(row.profile_id),
  }
}

function toTier(row: Row): QuizTier {
  return {
    id: str(row.id),
    quizId: str(row.quiz_id),
    key: str(row.key),
    position: num(row.position),
    minScore: num(row.min_score),
    maxScore: num(row.max_score),
    headline: str(row.headline),
    body: str(row.body),
    ctaLabel: strOrNull(row.cta_label),
    ctaHref: strOrNull(row.cta_href),
  }
}

function toProfile(row: Row): QuizProfile {
  return {
    id: str(row.id),
    quizId: str(row.quiz_id),
    key: str(row.key),
    name: str(row.name),
    description: str(row.description),
    position: num(row.position),
  }
}

/**
 * Assembles a whole quiz.
 *
 * SORTS IN MEMORY RATHER THAN RELYING ON THE QUERY. `.order()` is issued too,
 * but the sort here is what the tests pin: a definition whose questions arrive
 * in insertion order scores a different branch walk, and "the database usually
 * returns them in order" is not a guarantee.
 */
async function assemble(quizRow: Row, opts: { includeInactive?: boolean } = {}): Promise<QuizDefinition> {
  const supabase = getClient()
  const quizId = str(quizRow.id)

  const [branchesRes, questionsRes, tiersRes, profilesRes] = await Promise.all([
    supabase.from("quiz_branches").select("*").eq("quiz_id", quizId).order("position"),
    supabase.from("quiz_questions").select("*").eq("quiz_id", quizId).order("position"),
    supabase.from("quiz_tiers").select("*").eq("quiz_id", quizId).order("position"),
    supabase.from("quiz_profiles").select("*").eq("quiz_id", quizId).order("position"),
  ])
  for (const res of [branchesRes, questionsRes, tiersRes, profilesRes]) {
    if (res.error) throw res.error
  }

  const questionRows = ((questionsRes.data ?? []) as Row[])
    .filter((row) => opts.includeInactive === true || row.is_active !== false)
    .sort((a, b) => num(a.position) - num(b.position))

  const questionIds = questionRows.map((row) => str(row.id))
  // `.in()` with an empty list is a query that matches nothing but still costs
  // a round trip, and PostgREST has historically been inconsistent about it.
  const optionRows = questionIds.length
    ? await supabase.from("quiz_options").select("*").in("question_id", questionIds).order("position")
    : { data: [] as Row[], error: null }
  if (optionRows.error) throw optionRows.error

  const optionsByQuestion = new Map<string, QuizOption[]>()
  for (const row of (optionRows.data ?? []) as Row[]) {
    const option = toOption(row)
    const list = optionsByQuestion.get(option.questionId) ?? []
    list.push(option)
    optionsByQuestion.set(option.questionId, list)
  }
  for (const list of optionsByQuestion.values()) list.sort((a, b) => a.position - b.position)

  const questions: QuizQuestion[] = questionRows.map((row) => ({
    id: str(row.id),
    quizId,
    branchId: strOrNull(row.branch_id),
    position: num(row.position),
    prompt: str(row.prompt),
    helpText: strOrNull(row.help_text),
    isActive: row.is_active !== false,
    options: optionsByQuestion.get(str(row.id)) ?? [],
  }))

  return {
    id: quizId,
    key: str(quizRow.key),
    name: str(quizRow.name),
    status: (str(quizRow.status) || "draft") as QuizDefinition["status"],
    introHeadline: str(quizRow.intro_headline),
    introBody: str(quizRow.intro_body),
    gateHeadline: str(quizRow.gate_headline),
    gateBody: str(quizRow.gate_body),
    resultHeadline: str(quizRow.result_headline),
    seedMarker: strOrNull(quizRow.seed_marker),
    branches: ((branchesRes.data ?? []) as Row[]).map(toBranch).sort((a, b) => a.position - b.position),
    questions,
    tiers: ((tiersRes.data ?? []) as Row[]).map(toTier).sort((a, b) => a.position - b.position),
    profiles: ((profilesRes.data ?? []) as Row[]).map(toProfile).sort((a, b) => a.position - b.position),
  }
}

/** Returns null — never a half-built object — when the quiz does not exist. */
export async function getQuizDefinition(quizId: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient().from("quizzes").select("*").eq("id", quizId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row)
}

export async function getQuizDefinitionByKey(key: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient()
    .from("quizzes")
    .select("*")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .eq("key", key)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row)
}

/**
 * The editor's read. IDENTICAL TO `getQuizDefinition` EXCEPT THAT IT KEEPS
 * INACTIVE QUESTIONS, and that one difference is the entire reason it exists.
 *
 * A retired question is invisible to `getQuizDefinition` by design — the walk
 * must never offer one. But invisible IN THE EDITOR means the owner cannot see
 * what they retired or bring it back, and a newly added question (which
 * arrives switched off, so a half-typed question cannot reach a visitor)
 * disappears the moment the page reloads. Both failures are silent: the row is
 * in the table, the save reported success, and the screen simply does not show
 * it.
 *
 * NAMED RATHER THAN PARAMETERISED. An options bag on `getQuizDefinition` would
 * let a caller on the public path reach inactive questions by forgetting an
 * argument, and that path is the one where being wrong shows a visitor a
 * question nobody meant to ask.
 *
 * `quizGate` filters `isActive` itself, so handing it this wider definition
 * changes no verdict.
 */
export async function getQuizDefinitionForEditor(quizId: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient().from("quizzes").select("*").eq("id", quizId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row, { includeInactive: true })
}

export interface QuizListRow {
  id: string
  key: string
  name: string
  status: string
  seedMarker: string | null
  updatedAt: string | null
}

export async function listQuizzes(): Promise<QuizListRow[]> {
  const { data, error } = await getClient()
    .from("quizzes")
    .select("id, key, name, status, seed_marker, updated_at")
    .eq("business_id", SINGLETON_BUSINESS_ID)
    .order("updated_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id),
    key: str(row.key),
    name: str(row.name),
    status: str(row.status),
    seedMarker: strOrNull(row.seed_marker),
    updatedAt: strOrNull(row.updated_at),
  }))
}

/**
 * A free `key` for a new quiz. `quizzes` carries `UNIQUE (business_id, key)`,
 * and a collision here is a Postgres 500 at the exact moment the owner clicks
 * Create — so the suffix is derived before the insert rather than retried
 * after it.
 */
async function uniqueQuizKey(supabase: ReturnType<typeof getClient>, base: string): Promise<string> {
  const { data, error } = await supabase.from("quizzes").select("key").eq("business_id", SINGLETON_BUSINESS_ID)
  if (error) throw error
  const taken = new Set(((data ?? []) as Row[]).map((row) => str(row.key)))
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("createQuizFrom: could not derive a free key")
}

/**
 * Inserts `rows` mapped through `toRow`, and returns old-id → new-id.
 *
 * THE NEW IDS ARE MINTED HERE, NOT READ BACK FROM `RETURNING`. Postgres does
 * not promise that a multi-row insert returns in VALUES order — `createFunnel`
 * in lib/db/funnels.ts carries the same warning, having been bitten by it — and
 * a mapping built from a mis-ordered RETURNING would attach every option to
 * the wrong question while inserting the right number of rows.
 */
async function insertMapped<T extends { id: string }>(
  supabase: ReturnType<typeof getClient>,
  table: string,
  rows: readonly T[],
  toRow: (row: T) => Row,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const payload: Row[] = []
  for (const row of rows) {
    const newId = globalThis.crypto.randomUUID()
    map.set(row.id, newId)
    payload.push({ id: newId, ...toRow(row) })
  }
  if (payload.length === 0) return map
  const { error } = await supabase.from(table).insert(payload)
  if (error) throw new Error(`createQuizFrom(${table}): ${error.message}`)
  return map
}

/**
 * Inserts a NEW quiz that is a copy of `source`.
 *
 * IT TAKES A DEFINITION, NOT A SOURCE ID, so one function serves both things
 * the create dialog offers: a quiz already in the database
 * (`getQuizDefinition`) and the built-in blueprint
 * (`toDefinition(RPI_ATHLETE_QUIZ)`, which is in no table at all). It performs
 * no read of its own to discover what it is copying, which is also what keeps
 * it testable without a fixture quiz.
 *
 * THE REMAPPING IS THE WHOLE JOB. Questions carry `branch_id`; options carry
 * `routes_to_branch_id` and `profile_id`. Letting any of the three through
 * unmapped is not a loud failure — every row inserts and the counts are right —
 * it produces a clone whose own branches are unreachable, which surfaces only
 * when somebody tries to activate it and the gate says so.
 *
 * A COPY FROM `getQuizDefinition` LEAVES RETIRED QUESTIONS BEHIND, because
 * that read filters them out. That is the wanted behaviour: a new quiz should
 * not start life carrying questions its source had already withdrawn.
 *
 * Spec: docs/superpowers/specs/2026-08-24-quiz-funnel-creator-design.md §3
 */
export async function createQuizFrom(input: { source: QuizDefinition; name: string }): Promise<{ id: string; key: string }> {
  const supabase = getClient()
  // `slugify` caps at 80 and can return "" for a name with no letters or
  // digits in it; "quiz" is a key, not a label, so a fallback is honest.
  const key = await uniqueQuizKey(supabase, slugify(input.name) || "quiz")
  const quizId = globalThis.crypto.randomUUID()

  const { error: quizError } = await supabase.from("quizzes").insert({
    id: quizId,
    business_id: SINGLETON_BUSINESS_ID,
    key,
    name: input.name,
    // A COPY IS A DRAFT, even from an active source. Going live stays a
    // deliberate act that runs the gate — otherwise copying a live quiz puts
    // one in front of visitors under whatever name the funnel happened to have.
    status: "draft",
    intro_headline: input.source.introHeadline,
    intro_body: input.source.introBody,
    gate_headline: input.source.gateHeadline,
    gate_body: input.source.gateBody,
    result_headline: input.source.resultHeadline,
    // CARRIED, NOT CLEARED. The marker means "these numbers were reconstructed,
    // not recovered", and it drives the editor's banner. A copy inherits the
    // invented weights and cutoffs, so it inherits the warning; clearing it
    // here would launder a guess into a decision. It clears the way it always
    // did — the first time a human saves the quiz.
    seed_marker: input.source.seedMarker,
  })
  if (quizError) throw new Error(`createQuizFrom(quizzes): ${quizError.message}`)

  const branchIds = await insertMapped(supabase, "quiz_branches", input.source.branches, (branch) => ({
    quiz_id: quizId,
    // Child keys are unique PER QUIZ, so they are kept verbatim. Note that
    // branch keys are a contract the archetype sequences filter on: a clone
    // enrols into the same sequences as its source, deliberately.
    key: branch.key,
    name: branch.name,
    description: branch.description,
    position: branch.position,
  }))
  const profileIds = await insertMapped(supabase, "quiz_profiles", input.source.profiles, (profile) => ({
    quiz_id: quizId,
    key: profile.key,
    name: profile.name,
    description: profile.description,
    position: profile.position,
  }))
  const questionIds = await insertMapped(supabase, "quiz_questions", input.source.questions, (question) => ({
    quiz_id: quizId,
    branch_id: question.branchId ? (branchIds.get(question.branchId) ?? null) : null,
    position: question.position,
    prompt: question.prompt,
    help_text: question.helpText,
    is_active: question.isActive,
  }))
  await insertMapped(
    supabase,
    "quiz_options",
    input.source.questions.flatMap((question) => question.options),
    (option) => ({
      question_id: questionIds.get(option.questionId),
      position: option.position,
      label: option.label,
      weight: option.weight,
      routes_to_branch_id: option.routesToBranchId ? (branchIds.get(option.routesToBranchId) ?? null) : null,
      profile_id: option.profileId ? (profileIds.get(option.profileId) ?? null) : null,
    }),
  )
  await insertMapped(supabase, "quiz_tiers", input.source.tiers, (tier) => ({
    quiz_id: quizId,
    key: tier.key,
    position: tier.position,
    min_score: tier.minScore,
    max_score: tier.maxScore,
    headline: tier.headline,
    body: tier.body,
    cta_label: tier.ctaLabel,
    cta_href: tier.ctaHref,
  }))

  return { id: quizId, key }
}

export interface QuizSaveInput {
  quizId: string
  quiz?: {
    name?: string
    status?: QuizStatus
    introHeadline?: string
    introBody?: string
    gateHeadline?: string
    gateBody?: string
    resultHeadline?: string
    /** Set null to clear the "reconstructed, unverified" banner. */
    seedMarker?: string | null
  }
  questions?: { id: string; position?: number; prompt?: string; helpText?: string | null; isActive?: boolean }[]
  options?: { id: string; label?: string; weight?: number; routesToBranchId?: string | null; profileId?: string | null }[]
  tiers?: { id: string; minScore?: number; maxScore?: number; headline?: string; body?: string; ctaLabel?: string | null; ctaHref?: string | null }[]
  profiles?: { id: string; name?: string; description?: string; position?: number }[]
  branches?: { id: string; name?: string; description?: string | null; position?: number }[]
}

/**
 * Applies an editor save.
 *
 * UPDATES ONLY — no inserts, no deletes. The editor edits an existing quiz;
 * adding and removing questions is a bigger piece of work with its own
 * ordering and orphan questions, and a half-built version of it here would
 * let a save silently drop an option a live page is already showing.
 *
 * Every child update is scoped by BOTH its own id and its parent, so a
 * payload naming a row from another quiz writes nothing rather than editing
 * someone else's page.
 */
export async function saveQuizDefinition(input: QuizSaveInput): Promise<void> {
  const supabase = getClient()
  const { quizId } = input

  if (input.quiz && Object.keys(input.quiz).length > 0) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const q = input.quiz
    if (q.name !== undefined) patch.name = q.name
    if (q.status !== undefined) patch.status = q.status
    if (q.introHeadline !== undefined) patch.intro_headline = q.introHeadline
    if (q.introBody !== undefined) patch.intro_body = q.introBody
    if (q.gateHeadline !== undefined) patch.gate_headline = q.gateHeadline
    if (q.gateBody !== undefined) patch.gate_body = q.gateBody
    if (q.resultHeadline !== undefined) patch.result_headline = q.resultHeadline
    if (q.seedMarker !== undefined) patch.seed_marker = q.seedMarker
    const { error } = await supabase
      .from("quizzes")
      .update(patch)
      .eq("id", quizId)
      .eq("business_id", SINGLETON_BUSINESS_ID)
    if (error) throw error
  }

  for (const question of input.questions ?? []) {
    const patch: Record<string, unknown> = {}
    if (question.position !== undefined) patch.position = question.position
    if (question.prompt !== undefined) patch.prompt = question.prompt
    if (question.helpText !== undefined) patch.help_text = question.helpText
    if (question.isActive !== undefined) patch.is_active = question.isActive
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabase.from("quiz_questions").update(patch).eq("id", question.id).eq("quiz_id", quizId)
    if (error) throw error
  }

  if ((input.options ?? []).length > 0) {
    // Options hang off questions, not the quiz, so the ownership check is a
    // read of this quiz's question ids rather than a column on the row.
    const { data: owned, error: readError } = await supabase.from("quiz_questions").select("id").eq("quiz_id", quizId)
    if (readError) throw readError
    const ownedIds = new Set((owned ?? []).map((row) => str((row as Row).id)))
    for (const option of input.options ?? []) {
      const patch: Record<string, unknown> = {}
      if (option.label !== undefined) patch.label = option.label
      if (option.weight !== undefined) patch.weight = option.weight
      if (option.routesToBranchId !== undefined) patch.routes_to_branch_id = option.routesToBranchId
      if (option.profileId !== undefined) patch.profile_id = option.profileId
      if (Object.keys(patch).length === 0) continue
      const { error } = await supabase
        .from("quiz_options")
        .update(patch)
        .eq("id", option.id)
        .in("question_id", [...ownedIds])
      if (error) throw error
    }
  }

  for (const tier of input.tiers ?? []) {
    const patch: Record<string, unknown> = {}
    if (tier.minScore !== undefined) patch.min_score = tier.minScore
    if (tier.maxScore !== undefined) patch.max_score = tier.maxScore
    if (tier.headline !== undefined) patch.headline = tier.headline
    if (tier.body !== undefined) patch.body = tier.body
    if (tier.ctaLabel !== undefined) patch.cta_label = tier.ctaLabel
    if (tier.ctaHref !== undefined) patch.cta_href = tier.ctaHref
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabase.from("quiz_tiers").update(patch).eq("id", tier.id).eq("quiz_id", quizId)
    if (error) throw error
  }

  for (const profile of input.profiles ?? []) {
    const patch: Record<string, unknown> = {}
    if (profile.name !== undefined) patch.name = profile.name
    if (profile.description !== undefined) patch.description = profile.description
    if (profile.position !== undefined) patch.position = profile.position
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabase.from("quiz_profiles").update(patch).eq("id", profile.id).eq("quiz_id", quizId)
    if (error) throw error
  }

  for (const branch of input.branches ?? []) {
    const patch: Record<string, unknown> = {}
    if (branch.name !== undefined) patch.name = branch.name
    if (branch.description !== undefined) patch.description = branch.description
    if (branch.position !== undefined) patch.position = branch.position
    if (Object.keys(patch).length === 0) continue
    const { error } = await supabase.from("quiz_branches").update(patch).eq("id", branch.id).eq("quiz_id", quizId)
    if (error) throw error
  }
}

export interface QuizAttemptCounts {
  total: number
  completed: number
}

/**
 * Attempts per quiz, split by whether they finished.
 *
 * BOTH NUMBERS, not just the completed one. The gap between them IS the
 * drop-off — the whole reason progress is written at all — and a list showing
 * only completions would make an abandoned quiz look like an unused one.
 *
 * One read, counted in memory: there are a handful of quizzes and PostgREST
 * has no GROUP BY, so a per-quiz count query would be N round trips to avoid
 * an array walk.
 */
export async function getQuizAttemptCounts(): Promise<Record<string, QuizAttemptCounts>> {
  const { data, error } = await getClient()
    .from("quiz_attempts")
    .select("quiz_id, status")
    .eq("business_id", SINGLETON_BUSINESS_ID)
  if (error) throw error
  const out: Record<string, QuizAttemptCounts> = {}
  for (const row of (data ?? []) as Row[]) {
    const key = str(row.quiz_id)
    const entry = (out[key] ??= { total: 0, completed: 0 })
    entry.total++
    if (str(row.status) === "completed") entry.completed++
  }
  return out
}

export interface QuizAttemptRow {
  id: string
  quizId: string
  branchId: string | null
  status: string
  answers: QuizAnswer[]
}

export async function getAttempt(attemptId: string): Promise<QuizAttemptRow | null> {
  const { data, error } = await getClient()
    .from("quiz_attempts")
    .select("id, quiz_id, branch_id, status, answers")
    .eq("id", attemptId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as Row
  return {
    id: str(row.id),
    quizId: str(row.quiz_id),
    branchId: strOrNull(row.branch_id),
    status: str(row.status),
    answers: Array.isArray(row.answers) ? (row.answers as QuizAnswer[]) : [],
  }
}

export async function createAttempt(input: {
  quizId: string
  attributionSessionId: string | null
}): Promise<string> {
  const { data, error } = await getClient()
    .from("quiz_attempts")
    .insert({
      business_id: SINGLETON_BUSINESS_ID,
      quiz_id: input.quizId,
      attribution_session_id: input.attributionSessionId,
    })
    .select("id")
    .single()
  if (error) throw error
  return str((data as Row).id)
}

export async function saveAttemptProgress(input: {
  attemptId: string
  branchId: string | null
  answers: QuizAnswer[]
}): Promise<void> {
  const { error } = await getClient()
    .from("quiz_attempts")
    .update({
      branch_id: input.branchId,
      answers: input.answers,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.attemptId)
    // A finished result is not editable after the fact. Without this the
    // progress endpoint could rewrite the answers behind a score already shown
    // to the visitor and already acted on by the pipeline.
    .eq("status", "in_progress")
  if (error) throw error
}

export async function completeAttempt(input: {
  attemptId: string
  branchId: string | null
  answers: QuizAnswer[]
  rawScore: number
  maxScore: number
  score: number
  tierKey: string | null
  profileKey: string | null
  contactId: string | null
}): Promise<void> {
  const { error } = await getClient()
    .from("quiz_attempts")
    .update({
      branch_id: input.branchId,
      answers: input.answers,
      status: "completed",
      raw_score: input.rawScore,
      // Stored, never recomputed. This is what makes a past result immutable:
      // deriving an old percentage from today's weights would let a weight
      // edit silently rewrite what someone was told in March (spec §1.10).
      max_score: input.maxScore,
      score: input.score,
      tier_key: input.tierKey,
      profile_key: input.profileKey,
      contact_id: input.contactId,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.attemptId)
  if (error) throw error
}

export async function setAttemptAlert(input: {
  attemptId: string
  status: QuizAlertStatus
}): Promise<void> {
  const { error } = await getClient()
    .from("quiz_attempts")
    .update({
      alert_status: input.status,
      alerted_at: input.status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", input.attemptId)
  if (error) throw error
}
