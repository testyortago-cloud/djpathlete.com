// functions/src/lib/notify-business-owners.ts
//
// The in-app bell for an agent's alert, addressed to the OWNERS of the
// business the job was enqueued for (G35; the owner's ruling: "owners of the
// job's business, as in-app bell rows"). Two callers: the SEO agent's
// flag_for_human action (seo/execute.ts) and the social agent's "no eligible
// topic" branch (social-agent.ts). The job input carries the business because
// nothing else in this pipeline can: every table the agents read and write
// has no business_id.
//
// WHAT THIS REPLACED. Both callers read `profiles` for the first row with
// role='admin'. There is no `profiles` table, so PostgREST answered PGRST205
// on every run and no agent alert has ever reached anyone; the social branch
// did not even look at the error. Pointing that read at `users` would have
// made it live and untenanted at once: "the first platform admin", whichever
// business the job was about.
//
// THE STRINGS ARE LITERAL ON PURPOSE. `npm run test:integration:selects`
// collects every `.from(...).select(...)` in functions/src and probes it, with
// its `.order()` columns, against the dev clone's live schema. It resolves
// only string literals and consts; a table, select or order column passed in
// as a parameter lands on that test's KNOWN_UNRESOLVED ratchet and fails the
// run. Keep every string in both chains below literal.
//
// ONE ID BACK, NOT A LIST. The SEO agent stores what this returns as the
// action's execution_target_id, and the outcome tracker resolves it 14 days
// later by reading ONE notifications row by id (resolveFlagOutcome, in the
// Next.js app). `notifications` has no column tying sibling rows together, so
// the other owners' rows cannot be found from it. The id returned is therefore
// the FIRST owner's row in a fixed order (business_members.created_at, then
// user_id), and "acknowledged" on that memo means THAT owner read it. With one
// owner per business, which is every business on the dev clone today, that is
// the whole story. The first owner's row is found by user_id in what the
// insert returns, not by position: RETURNING order is not something PostgREST
// promises.
//
// Errors come back as values, never thrown. PostgREST resolves a failure
// rather than throwing (the booking ingest's business_members fan-out checks
// its read the same way), and neither caller should fail its whole run
// because a bell could not be rung: one is a weekly action loop, the other a
// job that has already, correctly, decided not to draft.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface OwnerNotification {
  /** notifications.type is CHECK-constrained to these four. */
  type: "info" | "success" | "warning" | "error"
  title: string
  message: string
  link: string | null
}

export type NotifyOwnersResult =
  | { ok: true; notificationId: string; ownerCount: number }
  | { ok: false; error: string }

export async function notifyBusinessOwners(
  supabase: SupabaseClient,
  businessId: string,
  notification: OwnerNotification,
): Promise<NotifyOwnersResult> {
  const { data: owners, error: ownersError } = await supabase
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
  if (ownersError) {
    return { ok: false, error: `business_members read failed (${ownersError.code} ${ownersError.message})` }
  }
  const ownerIds = ((owners as Array<{ user_id: string }> | null) ?? []).map((o) => o.user_id)
  if (ownerIds.length === 0) {
    // Not defaulted to anyone. The schema does not require an owner (the only
    // key is (business_id, user_id)), and ringing some other business's bell
    // is the leak this helper exists to close.
    return { ok: false, error: `business ${businessId} has no owner to notify` }
  }

  const { data: rows, error: insertError } = await supabase
    .from("notifications")
    .insert(
      ownerIds.map((userId) => ({
        user_id: userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        is_read: false,
      })),
    )
    .select("id, user_id")
  if (insertError) {
    return { ok: false, error: `notifications insert failed (${insertError.code} ${insertError.message})` }
  }
  const first = ((rows as Array<{ id: string; user_id: string }> | null) ?? []).find(
    (r) => r.user_id === ownerIds[0],
  )
  if (!first) {
    return { ok: false, error: "notifications insert returned no row for the first owner" }
  }
  return { ok: true, notificationId: first.id, ownerCount: ownerIds.length }
}
