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
import type {
  QuizAlertStatus,
  QuizAnswer,
  QuizBranch,
  QuizDefinition,
  QuizOption,
  QuizProfile,
  QuizQuestion,
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
async function assemble(quizRow: Row): Promise<QuizDefinition> {
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
    .filter((row) => row.is_active !== false)
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
