import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getCompletedSessionCount, getTotalVolumeKg, listCompletedSessionSummaries } from "@/lib/db/workout-sessions"
import { getPerformanceAssessmentsByClient, getAssessmentExercises } from "@/lib/db/performance-assessments"
import { buildMonthlyTraining, type MonthlyTraining } from "./monthly"
import { getWorkoutStreak } from "@/lib/db/progress"
import { getAchievements, getAchievementsByType } from "@/lib/db/achievements"
import { getPRsByUser, listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getActiveAssignmentWithProgram, getCompletedAssignments } from "@/lib/db/assignments"
import { getExerciseNamesByIds } from "@/lib/db/exercises"
import { effectiveTotalWeeks } from "@/lib/program-weeks"
import { dailyLoads } from "@/lib/coach-intel/load"
import { computeBadges, type Badge } from "@/lib/badges"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { Achievement, PerformanceTest, TestType, WeightUnit } from "@/types/database"

export interface GymRecord {
  exercise: string
  valueKg: number
  date: string
}

export interface FieldRecord {
  label: string
  value: number
  unit: string
  date: string
}

/**
 * Scrubbed projection of a performance test for the PUBLIC card. Never expose
 * raw PerformanceTest rows: they carry notes (internal coach notes), video_url
 * (form-check footage), created_by and client_user_id — RSC serialization
 * would embed all of it in the public page payload.
 */
export interface RadarTestPoint {
  testType: TestType
  resultValue: number
  resultUnit: string
  customName: string | null
  bodyWeightKg: number | null
  testDate: string
}

/**
 * Scrubbed projection of a completed assessment battery. admin_notes,
 * video_path/youtube_url and message threads must never reach the public card.
 */
export interface PublicAssessment {
  title: string
  date: string
  items: { name: string; value: number | null; unit: string | null }[]
}

export interface AthleteProfileData {
  name: { first: string; last: string }
  avatarUrl: string | null
  sport: string | null
  position: string | null
  experienceLevel: string | null
  heightCm: number | null
  weightKg: number | null
  weightUnit: WeightUnit
  age: number | null
  memberSince: string
  stats: { workouts: number; streakDays: number; totalVolumeKg: number; prCount: number }
  gymRecords: GymRecord[]
  fieldRecords: FieldRecord[]
  radarTests: RadarTestPoint[]
  program: {
    name: string
    currentWeek: number
    totalWeeks: number
    difficulty: string | null
    categories: string[]
    splitType: string | null
  } | null
  career: { name: string; completedAt: string }[]
  badges: Badge[]
  milestones: { title: string; description: string | null; type: string; earnedAt: string }[]
  monthlyTraining: MonthlyTraining[]
  assessments: PublicAssessment[]
}

/** Age in whole years from an ISO date (public card shows age, never the DOB). */
export function computeAge(dobIso: string | null, now = new Date()): number | null {
  if (!dobIso) return null
  const dob = new Date(dobIso.length === 10 ? `${dobIso}T00:00:00Z` : dobIso)
  if (isNaN(dob.getTime())) return null
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--
  return age >= 0 && age < 130 ? age : null
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function settle<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback
}

const MAX_RECORDS = 6
const MAX_MILESTONES = 8
const MAX_CAREER = 8
const MAX_ASSESSMENTS = 3
const MAX_ASSESSMENT_ITEMS = 8

/**
 * COMPLETED assessment batteries only, scrubbed to name/value/unit. Items
 * without a logged result are dropped; a battery left with no measured items
 * is dropped whole (an empty panel reads as broken, not premium).
 */
async function loadPublicAssessments(clientUserId: string): Promise<PublicAssessment[]> {
  const all = await getPerformanceAssessmentsByClient(clientUserId)
  const completed = (all ?? [])
    .filter((a: { status: string; is_template: boolean }) => a.status === "completed" && !a.is_template)
    .slice(0, MAX_ASSESSMENTS)

  const out: PublicAssessment[] = []
  for (const a of completed as { id: string; title: string; updated_at: string }[]) {
    const exercises = await getAssessmentExercises(a.id).catch(() => [])
    const withResults = (exercises as {
      exercise_id: string | null
      custom_name: string | null
      result_value: number | null
      result_unit: string | null
      order_index: number
    }[]).filter((e) => e.result_value !== null)
    const ids = withResults.map((e) => e.exercise_id).filter((id): id is string => id !== null)
    const names = await getExerciseNamesByIds(ids).catch(() => ({}) as Record<string, string>)
    const items = withResults
      .sort((x, y) => x.order_index - y.order_index)
      .slice(0, MAX_ASSESSMENT_ITEMS)
      .map((e) => ({
        name: e.custom_name ?? (e.exercise_id ? (names[e.exercise_id] ?? "Exercise") : "Exercise"),
        value: e.result_value,
        unit: e.result_unit,
      }))
    if (items.length > 0) out.push({ title: a.title, date: a.updated_at, items })
  }
  return out
}

/**
 * Assembles everything the public card shows. Returns null when the user must
 * not have a public card (missing, not a client, or not active); individual
 * data sources fail soft to empty sections, and a missing client_profiles row
 * just leaves the bio fields empty.
 */
export async function getAthleteProfileData(clientUserId: string): Promise<AthleteProfileData | null> {
  let user
  try {
    user = await getUserById(clientUserId)
  } catch {
    return null
  }
  if (!user || user.role !== "client" || user.status !== "active") return null

  // The profile row is optional: without one the card still renders, just with
  // empty sport/position/physicals. Minors are NOT excluded — the coach decides
  // who gets a share link (deactivating the client kills an issued link).
  const profile = await getProfileByUserId(clientUserId).catch(() => null)
  const age = computeAge(profile?.date_of_birth ?? null)

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -90)

  const [
    workoutsR, streakR, volumeR, prAchievementsR, fieldPRsR, testsR,
    trainingSessionsR, readinessR, assignmentR, completedR, allAchievementsR,
    sessionSummariesR, assessmentsR,
  ] = await Promise.allSettled([
    getCompletedSessionCount(clientUserId),
    getWorkoutStreak(clientUserId),
    getTotalVolumeKg(clientUserId),
    getAchievementsByType(clientUserId, "pr"),
    getPRsByUser(clientUserId),
    listTests(clientUserId),
    listTrainingSessions(clientUserId, { from, to: today }),
    listReadiness(clientUserId, { from, to: today }),
    getActiveAssignmentWithProgram(clientUserId),
    getCompletedAssignments(clientUserId),
    getAchievements(clientUserId),
    listCompletedSessionSummaries(clientUserId),
    loadPublicAssessments(clientUserId),
  ])

  const prAchievements = settle(prAchievementsR, [] as Achievement[])
  const fieldPRs = settle(fieldPRsR, [])
  const tests = settle(testsR, [] as PerformanceTest[])
  const assignment = settle(assignmentR, null)
  const completed = settle(completedR, [])
  const allAchievements = settle(allAchievementsR, [] as Achievement[])

  // Best weight PR per exercise (titles are generic; the exercise lives behind exercise_id).
  const bestByExercise = new Map<string, Achievement>()
  for (const a of prAchievements) {
    if (a.title !== "Weight PR!" || !a.exercise_id || a.metric_value == null) continue
    const cur = bestByExercise.get(a.exercise_id)
    if (!cur || a.metric_value > (cur.metric_value ?? 0)) bestByExercise.set(a.exercise_id, a)
  }
  const names = await getExerciseNamesByIds([...bestByExercise.keys()]).catch(() => ({}) as Record<string, string>)
  const gymRecords: GymRecord[] = [...bestByExercise.values()]
    .map((a) => ({ exercise: names[a.exercise_id!] ?? "", valueKg: a.metric_value!, date: a.earned_at }))
    .filter((r) => r.exercise)
    .sort((a, b) => b.valueKg - a.valueKg)
    .slice(0, MAX_RECORDS)

  const fieldRecords: FieldRecord[] = [...fieldPRs]
    .sort((a, b) => b.test_date.localeCompare(a.test_date))
    .slice(0, MAX_RECORDS)
    .map((p) => ({
      label: p.test_type === "custom" ? (p.custom_name ?? "Custom") : TEST_TYPE_LABELS[p.test_type as TestType],
      value: p.result_value,
      unit: p.result_unit,
      date: p.test_date,
    }))

  const badges = computeBadges({
    asOf: today,
    dailyLoads: dailyLoads(settle(trainingSessionsR, []), from, today),
    tests,
    readiness: settle(readinessR, []),
    monthlyCompliancePct: null,
  })

  const milestones = allAchievements
    .filter((a) => a.achievement_type !== "pr")
    .slice(0, MAX_MILESTONES)
    .map((a) => ({ title: a.title, description: a.description, type: a.achievement_type, earnedAt: a.earned_at }))

  return {
    name: { first: user.first_name, last: user.last_name },
    avatarUrl: user.avatar_url,
    sport: profile?.sport ?? null,
    position: profile?.position ?? null,
    experienceLevel: profile?.experience_level ?? null,
    heightCm: profile?.height_cm ?? null,
    weightKg: profile?.weight_kg ?? null,
    weightUnit: profile?.weight_unit ?? "kg",
    age,
    memberSince: user.created_at,
    stats: {
      workouts: settle(workoutsR, 0),
      streakDays: settle(streakR, 0),
      totalVolumeKg: settle(volumeR, 0),
      prCount: prAchievements.length + fieldPRs.length,
    },
    gymRecords,
    fieldRecords,
    // Full rows feed computeBadges above (computation input); the public object
    // only ever gets this scrubbed projection.
    radarTests: tests.map((t) => ({
      testType: t.test_type,
      resultValue: t.result_value,
      resultUnit: t.result_unit,
      customName: t.custom_name ?? null,
      bodyWeightKg: t.body_weight_kg ?? null,
      testDate: t.test_date,
    })),
    program:
      assignment && assignment.programs
        ? {
            name: assignment.programs.name,
            currentWeek: assignment.current_week,
            totalWeeks: effectiveTotalWeeks(assignment.total_weeks, assignment.programs.duration_weeks),
            difficulty: assignment.programs.difficulty ?? null,
            categories: assignment.programs.category ?? [],
            splitType: assignment.programs.split_type ?? null,
          }
        : null,
    career: completed
      .slice(0, MAX_CAREER)
      .map((c) => ({ name: c.programs?.name ?? "Program", completedAt: c.updated_at })),
    badges,
    milestones,
    monthlyTraining: buildMonthlyTraining(settle(sessionSummariesR, [])),
    assessments: settle(assessmentsR, [] as PublicAssessment[]),
  }
}
