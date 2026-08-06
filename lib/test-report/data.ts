import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { listByUser } from "@/lib/db/performance-tests"
import { loadPublicAssessments, computeAge, type PublicAssessment } from "@/lib/profile-share/data"
import type { ReportTestPoint } from "./scoring"
import type { PerformanceTest } from "@/types/database"

export interface TestReportData {
  name: { first: string; last: string }
  avatarUrl: string | null
  sport: string | null
  position: string | null
  age: number | null
  /** Date of the most recent logged test — the report's "as of". null = no tests. */
  asOf: string | null
  testCount: number
  prCount: number
  /** Whole months between the first and last logged test. */
  monthsTracked: number
  tests: ReportTestPoint[]
  assessments: PublicAssessment[]
}

function settle<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback
}

function monthsBetween(firstIso: string, lastIso: string): number {
  const a = new Date(`${firstIso}T00:00:00Z`)
  const b = new Date(`${lastIso}T00:00:00Z`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  return Math.max(0, months)
}

/**
 * Assembles the public test report. Returns null when the user must not have a
 * report at all (missing, not a client, or deactivated) — deactivating a client
 * is how a share link gets revoked.
 *
 * Every field here is a deliberate PROJECTION. Raw `performance_tests` rows carry
 * `notes` (internal coach notes) and `video_url` (form-check footage); RSC
 * serialization would embed both in the public HTML payload, so they are never
 * copied across. Same rule as lib/profile-share/data.ts.
 */
export async function getTestReportData(clientUserId: string): Promise<TestReportData | null> {
  let user
  try {
    user = await getUserById(clientUserId)
  } catch {
    return null
  }
  if (!user || user.role !== "client" || user.status !== "active") return null

  // The profile row is optional: without one the report still renders, just with
  // an empty sport/position/age line under the athlete's name.
  const profile = await getProfileByUserId(clientUserId).catch(() => null)

  const [testsR, assessmentsR] = await Promise.allSettled([
    listByUser(clientUserId),
    loadPublicAssessments(clientUserId),
  ])

  const raw = settle(testsR, [] as PerformanceTest[])
  const tests: ReportTestPoint[] = raw.map((t) => ({
    testType: t.test_type,
    resultValue: t.result_value,
    resultUnit: t.result_unit,
    customName: t.custom_name ?? null,
    bodyWeightKg: t.body_weight_kg ?? null,
    testDate: t.test_date,
    isPr: t.is_pr,
  }))

  const dates = tests.map((t) => t.testDate).sort()
  const asOf = dates.length > 0 ? dates[dates.length - 1] : null

  return {
    name: { first: user.first_name, last: user.last_name },
    avatarUrl: user.avatar_url,
    sport: profile?.sport ?? null,
    position: profile?.position ?? null,
    age: computeAge(profile?.date_of_birth ?? null),
    asOf,
    testCount: tests.length,
    prCount: tests.filter((t) => t.isPr).length,
    monthsTracked: dates.length > 1 ? monthsBetween(dates[0], dates[dates.length - 1]) : 0,
    tests,
    assessments: settle(assessmentsR, [] as PublicAssessment[]),
  }
}
