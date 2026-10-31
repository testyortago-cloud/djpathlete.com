import type { TestType } from "@/types/database"
import { OutputAuthError, listMeasurements, refreshAccess } from "./api"
import { localDate, measurementsToTests, syncWindows, type OutputMeasurement } from "./map"
import {
  getLink,
  getRefreshToken,
  markSynced,
  setConnectionError,
  storeRefreshToken,
  upsertImportedTests,
} from "@/lib/db/output-sports"
import { recomputeDownstream } from "@/lib/db/performance-tests"
import { getBusinessSettings } from "@/lib/db/businesses"
import { checkGoals } from "@/lib/coach-intel/check-goals"
import { reduceTrials } from "@/lib/validators/performance-test"

export class OutputNotConnectedError extends Error {}
export class OutputNotLinkedError extends Error {}

const DAY_MS = 86_400_000
/** How far back the first sync of a newly linked client reads. */
const FIRST_SYNC_DAYS = 365
/** Later syncs re-read this many days before the last one, to catch results uploaded late. */
const OVERLAP_DAYS = 3

/**
 * A fresh access token for the business's Output account. When Output refuses the
 * stored token, the refusal is saved on the connection so Settings can ask for a
 * reconnect.
 */
export async function outputAccessToken(businessId: string): Promise<string> {
  const refresh = await getRefreshToken(businessId)
  if (!refresh) throw new OutputNotConnectedError("Output Sports is not connected. Connect it in Settings.")
  try {
    const t = await refreshAccess(refresh)
    if (t.refreshToken && t.refreshToken !== refresh) await storeRefreshToken(businessId, t.refreshToken)
    return t.accessToken
  } catch (err) {
    if (err instanceof OutputAuthError) await setConnectionError(businessId, err.message)
    throw err
  }
}

export interface SyncSummary {
  /** Days-and-tests written (one row per test per day). */
  imported: number
  added: number
  updated: number
  /** Results left in Output, by Output's category ("Mobility": 4). */
  skipped: Record<string, number>
}

/**
 * Pulls a linked client's Output results into their performance tests. Safe to run
 * again: each test-day is one row keyed on output_key, so a re-sync updates it.
 */
export async function syncClient(
  businessId: string,
  clientUserId: string,
  actorId: string,
  now = new Date(),
): Promise<SyncSummary> {
  const link = await getLink(businessId, clientUserId)
  if (!link) throw new OutputNotLinkedError("This client is not linked to an Output athlete.")
  const token = await outputAccessToken(businessId)
  const timeZone = await getBusinessSettings(businessId)
    .then((s) => s.timezone)
    .catch(() => "UTC")

  const from = link.last_synced_at
    ? new Date(Date.parse(link.last_synced_at) - OVERLAP_DAYS * DAY_MS)
    : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY_MS)
  const measurements: OutputMeasurement[] = []
  for (const w of syncWindows(from, now)) {
    measurements.push(
      ...(await listMeasurements(token, { ...w, athleteIds: [link.output_athlete_id], exerciseIds: [] })),
    )
  }

  const { rows, skipped } = measurementsToTests(measurements, timeZone, link.output_athlete_id)
  // The window starts part-way through its first day, so that day's row would hold only
  // some of its results and overwrite the full one. Days after it are complete.
  const firstDay = localDate(from.toISOString(), timeZone)
  const complete = rows.filter((r) => r.test_date > firstDay)
  const added = await upsertImportedTests(clientUserId, complete, actorId)

  const byType = new Map<TestType, typeof complete>()
  for (const r of complete) byType.set(r.test_type, [...(byType.get(r.test_type) ?? []), r])
  for (const [testType, list] of byType) {
    const earliest = list.reduce((min, r) => (r.test_date < min ? r.test_date : min), list[0].test_date)
    const dayBefore = new Date(Date.parse(`${earliest}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
    await recomputeDownstream(clientUserId, testType, dayBefore)
    const best = reduceTrials(
      list.map((r) => r.result_value),
      list[0].best_method,
    )
    try {
      await checkGoals(clientUserId, { testType, testValue: best })
    } catch (e) {
      console.error("[output-sports] checkGoals failed", e)
    }
  }

  await markSynced(businessId, clientUserId, now)
  return { imported: complete.length, added, updated: complete.length - added, skipped }
}
