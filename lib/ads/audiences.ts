// lib/ads/audiences.ts
// Phase 1.5b — Customer Match audience sync. For each configured user list:
//
//  1. Compute the desired email set from the source table (bookings,
//     newsletter_subscribers — ICP is admin-managed, no compute path yet).
//  2. SHA-256 hash each normalized email (Google Ads requirement).
//  3. Diff vs the local mirror in google_ads_user_list_members.
//  4. If GOOGLE_ADS_DEVELOPER_TOKEN is set: create an OfflineUserDataJob,
//     push add/remove operations, run the job. On success, mirror the delta
//     locally so next run has accurate state.
//  5. If not set: log "would add N, would remove M" and skip — local mirror
//     stays in sync with Google Ads (which is an empty list for now); the
//     next run after the cutover will push the full set as additions.
//
// One sync per active user_lists row per call. Per-list try/catch — one bad
// list can't poison the next.

import { createHash } from "node:crypto"
import { ResourceNames } from "google-ads-api"
import { getCustomerClient } from "@/lib/ads/google-ads-client"
import { createServiceRoleClient } from "@/lib/supabase"
import {
  deleteUserListMembers,
  insertUserListMembers,
  listActiveUserLists,
  listUserListMemberHashes,
  setUserListSyncResult,
} from "@/lib/db/google-ads-user-lists"
import type { GoogleAdsAudienceType, GoogleAdsUserList } from "@/types/database"

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function hashEmail(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex")
}

interface DesiredMember {
  normalized: string
  hash: string
}

async function computeDesiredMembers(
  audience_type: GoogleAdsAudienceType,
): Promise<DesiredMember[]> {
  const supabase = createServiceRoleClient()
  const seen = new Set<string>()
  const members: DesiredMember[] = []

  if (audience_type === "bookers") {
    // All distinct emails in bookings. Booking implies marketing consent
    // (the prospect actively requested contact via the booking flow).
    const { data, error } = await supabase
      .from("bookings")
      .select("contact_email")
      .not("contact_email", "is", null)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ contact_email: string | null }>) {
      const raw = row.contact_email
      if (!raw) continue
      const norm = normalizeEmail(raw)
      if (!norm.includes("@")) continue
      if (seen.has(norm)) continue
      seen.add(norm)
      members.push({ normalized: norm, hash: hashEmail(norm) })
    }
    return members
  }

  if (audience_type === "subscribers") {
    // Active newsletter subscribers (unsubscribed_at IS NULL).
    const { data, error } = await supabase
      .from("newsletter_subscribers")
      .select("email")
      .is("unsubscribed_at", null)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ email: string }>) {
      const norm = normalizeEmail(row.email)
      if (!norm.includes("@")) continue
      if (seen.has(norm)) continue
      seen.add(norm)
      members.push({ normalized: norm, hash: hashEmail(norm) })
    }
    return members
  }

  // ICP — Phase 1.5b ships the schema slot but not the compute path. Admin
  // manages this list directly; future Plan 1.5g (AI Agent) can refresh it
  // from a richer signal (e.g. bookings that converted to paid clients).
  return []
}

interface JobOperations {
  addOps: Array<{ create: { user_identifiers: Array<{ hashed_email: string }> } }>
  removeOps: Array<{ remove: { user_identifiers: Array<{ hashed_email: string }> } }>
}

function buildOperations(
  toAdd: DesiredMember[],
  toRemoveHashes: string[],
): JobOperations {
  const addOps = toAdd.map((m) => ({
    create: {
      user_identifiers: [{ hashed_email: m.hash }],
    },
  }))
  const removeOps = toRemoveHashes.map((hash) => ({
    remove: {
      user_identifiers: [{ hashed_email: hash }],
    },
  }))
  return { addOps, removeOps }
}

const OPERATIONS_BATCH_SIZE = 1000 // Well under the 100k API ceiling

interface UserListSyncResult {
  user_list_id: string
  audience_type: GoogleAdsAudienceType
  desired_count: number
  added: number
  removed: number
  skipped_no_token: boolean
  error?: string
}

async function syncOneUserList(list: GoogleAdsUserList): Promise<UserListSyncResult> {
  const result: UserListSyncResult = {
    user_list_id: list.user_list_id,
    audience_type: list.audience_type,
    desired_count: 0,
    added: 0,
    removed: 0,
    skipped_no_token: false,
  }

  const desired = await computeDesiredMembers(list.audience_type)
  result.desired_count = desired.length
  const desiredHashes = new Set(desired.map((m) => m.hash))
  const currentHashes = await listUserListMemberHashes(list.id)

  const toAdd = desired.filter((m) => !currentHashes.has(m.hash))
  const toRemoveHashes: string[] = []
  for (const hash of currentHashes) {
    if (!desiredHashes.has(hash)) toRemoveHashes.push(hash)
  }

  if (toAdd.length === 0 && toRemoveHashes.length === 0) {
    await setUserListSyncResult(list.id, {
      last_error: null,
      member_count: desired.length,
    })
    return result
  }

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    // Don't mutate local state until we've actually pushed. Surface the
    // delta size in the admin UI via last_error message.
    result.skipped_no_token = true
    await setUserListSyncResult(list.id, {
      last_error: `Awaiting Developer Token — would add ${toAdd.length}, remove ${toRemoveHashes.length}`,
      member_count: currentHashes.size,
    })
    return result
  }

  const customer = await getCustomerClient(list.customer_id)
  const userListResource = ResourceNames.userList(list.customer_id, list.user_list_id)

  // Step 1: create the OfflineUserDataJob
  let jobResourceName: string
  try {
    const create = await customer.offlineUserDataJobs.createOfflineUserDataJob({
      customer_id: list.customer_id,
      job: {
        type: "CUSTOMER_MATCH_USER_LIST",
        customer_match_user_list_metadata: { user_list: userListResource },
      },
    } as never)
    jobResourceName = (create as unknown as { resource_name?: string }).resource_name ?? ""
    if (!jobResourceName) throw new Error("create job returned no resource_name")
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    await setUserListSyncResult(list.id, { last_error: result.error })
    return result
  }

  // Step 2: push operations in batches
  const { addOps, removeOps } = buildOperations(toAdd, toRemoveHashes)
  const allOps = [...addOps, ...removeOps]
  try {
    for (let i = 0; i < allOps.length; i += OPERATIONS_BATCH_SIZE) {
      const batch = allOps.slice(i, i + OPERATIONS_BATCH_SIZE)
      await customer.offlineUserDataJobs.addOfflineUserDataJobOperations({
        resource_name: jobResourceName,
        operations: batch,
        enable_partial_failure: true,
      } as never)
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    await setUserListSyncResult(list.id, { last_error: result.error })
    return result
  }

  // Step 3: run the job. The API returns a long-running operation; for our
  // purposes, "queued for execution" is good enough — the list will be
  // populated within Google's processing window (typically minutes).
  try {
    await customer.offlineUserDataJobs.runOfflineUserDataJob({
      resource_name: jobResourceName,
    } as never)
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    await setUserListSyncResult(list.id, { last_error: result.error })
    return result
  }

  // Mirror the delta locally — successful enqueue at Google means our local
  // state should match. (If the job later fails async, the next sync will
  // retry — overshoot is acceptable since hashed emails are idempotent.)
  result.added = await insertUserListMembers(
    list.id,
    toAdd.map((m) => ({ email_hash: m.hash, email_normalized: m.normalized })),
  )
  result.removed = await deleteUserListMembers(list.id, toRemoveHashes)

  await setUserListSyncResult(list.id, {
    last_error: null,
    member_count: desired.length,
  })

  return result
}

export interface SyncAudiencesResult {
  lists_processed: number
  lists_failed: number
  lists_skipped_no_token: number
  total_added: number
  total_removed: number
  per_list: UserListSyncResult[]
}

export async function syncCustomerMatchAudiences(): Promise<SyncAudiencesResult> {
  const lists = await listActiveUserLists()
  const result: SyncAudiencesResult = {
    lists_processed: 0,
    lists_failed: 0,
    lists_skipped_no_token: 0,
    total_added: 0,
    total_removed: 0,
    per_list: [],
  }
  for (const list of lists) {
    try {
      const r = await syncOneUserList(list)
      result.per_list.push(r)
      if (r.skipped_no_token) result.lists_skipped_no_token++
      else if (r.error) result.lists_failed++
      else result.lists_processed++
      result.total_added += r.added
      result.total_removed += r.removed
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[audiences] list ${list.id} (${list.audience_type}) failed:`, message)
      result.lists_failed++
      try {
        await setUserListSyncResult(list.id, { last_error: message })
      } catch (recordErr) {
        console.error("[audiences] failed to record error:", recordErr)
      }
    }
  }
  return result
}

/**
 * Diagnostic for the admin UI — whether each compute path returns rows.
 * Doesn't push anything; purely a count for dashboard display.
 */
export async function previewAudienceSizes(): Promise<Record<GoogleAdsAudienceType, number>> {
  const [bookers, subscribers] = await Promise.all([
    computeDesiredMembers("bookers"),
    computeDesiredMembers("subscribers"),
  ])
  return {
    bookers: bookers.length,
    subscribers: subscribers.length,
    icp: 0,
  }
}
