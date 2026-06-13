import type {
  ClientPackage,
  ClientPackageStatus,
  PackReminderThreshold,
  CheckinMethod,
  SessionCheckin,
} from "@/types/database"
import {
  getActivePackageForClient,
  getClientPackageById,
  updateClientPackage,
} from "@/lib/db/client-packages"
import {
  createCheckin,
  getCheckinById,
  recentNonVoidedForPackage,
  voidCheckin,
} from "@/lib/db/session-checkins"

// ─── Pure credit math (single source of truth for balance) ───────────────────

type PackLike = Pick<ClientPackage, "credits_total" | "credits_used" | "expires_at">

export function remainingCredits(p: Pick<ClientPackage, "credits_total" | "credits_used">): number {
  return Math.max(0, p.credits_total - p.credits_used)
}

export function isExpired(p: Pick<ClientPackage, "expires_at">, now: Date): boolean {
  if (!p.expires_at) return false
  return new Date(p.expires_at).getTime() <= now.getTime()
}

export function packStatusAfter(p: PackLike, now: Date): ClientPackageStatus {
  if (isExpired(p, now)) return "expired"
  return remainingCredits(p) <= 0 ? "depleted" : "active"
}

/** Highest-priority reminder threshold this pack has reached, or null. */
export function reminderThreshold(
  p: PackLike,
  now: Date,
  lowAt: number,
  expiryDays: number,
): PackReminderThreshold | null {
  if (isExpired(p, now)) return null // already expired — not a renewal nudge
  const rem = remainingCredits(p)
  if (rem <= 0) return "empty"
  if (p.expires_at) {
    const days = (new Date(p.expires_at).getTime() - now.getTime()) / 86_400_000
    if (days <= expiryDays) return "expiring"
  }
  if (rem <= lowAt) return "low"
  return null
}

/** purchased_at + validityDays → ISO expires_at, or null when no validity window. */
export function expiresAtFrom(purchasedAtIso: string, validityDays: number | null): string | null {
  if (validityDays == null) return null
  const d = new Date(purchasedAtIso)
  d.setUTCDate(d.getUTCDate() + validityDays)
  return d.toISOString()
}

// ─── Orchestration (uses DALs + the pure math above) ─────────────────────────

const DEFAULT_IDEMPOTENCY_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 hours

export interface CheckInInput {
  clientUserId: string
  method: CheckinMethod
  createdBy: string | null
  now: Date
  idempotencyWindowMs?: number
  sessionDate?: string
}

export interface CheckInResult {
  ok: boolean
  reason?: "no_credits" | "duplicate"
  checkin?: SessionCheckin
  remaining?: number
  packageId?: string
}

/**
 * Deduct one credit from a client's oldest active pack.
 * - No active pack with credits → { ok:false, reason:"no_credits" }.
 * - A non-voided check-in already exists within the idempotency window →
 *   { ok:true, reason:"duplicate" } (returns the existing one, no double-deduct).
 */
export async function checkInClient(input: CheckInInput): Promise<CheckInResult> {
  const windowMs = input.idempotencyWindowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS
  const pkg = await getActivePackageForClient(input.clientUserId, input.now.toISOString())
  if (!pkg) return { ok: false, reason: "no_credits" }

  const since = new Date(input.now.getTime() - windowMs).toISOString()
  const recent = await recentNonVoidedForPackage(pkg.id, since)
  if (recent) {
    return { ok: true, reason: "duplicate", checkin: recent, remaining: remainingCredits(pkg), packageId: pkg.id }
  }

  const checkin = await createCheckin({
    client_package_id: pkg.id,
    client_user_id: input.clientUserId,
    checked_in_at: input.now.toISOString(),
    session_date: input.sessionDate ?? input.now.toISOString().slice(0, 10),
    method: input.method,
    credit_delta: -1,
    voided: false,
    voided_reason: null,
    voided_by: null,
    voided_at: null,
    calendar_event_id: null,
    created_by: input.createdBy,
    notes: null,
  })

  const newUsed = pkg.credits_used + 1
  const after = { credits_total: pkg.credits_total, credits_used: newUsed, expires_at: pkg.expires_at }
  const status = packStatusAfter(after, input.now)
  await updateClientPackage(pkg.id, { credits_used: newUsed, status })

  return { ok: true, checkin, remaining: remainingCredits(after), packageId: pkg.id }
}

export interface VoidResult {
  ok: boolean
  reason?: "not_found" | "already_voided"
}

/** Void a check-in: restore the credit and re-activate the pack if it was depleted. */
export async function voidCheckinAndRestore(input: {
  checkinId: string
  voidedBy: string | null
  reason: string | null
  now: Date
}): Promise<VoidResult> {
  const checkin = await getCheckinById(input.checkinId)
  if (!checkin) return { ok: false, reason: "not_found" }
  if (checkin.voided) return { ok: false, reason: "already_voided" }

  await voidCheckin(input.checkinId, { voided_by: input.voidedBy, voided_reason: input.reason })

  const pkg = await getClientPackageById(checkin.client_package_id)
  const newUsed = Math.max(0, pkg.credits_used - 1)
  const after = { credits_total: pkg.credits_total, credits_used: newUsed, expires_at: pkg.expires_at }
  // A refunded/cancelled pack stays in its terminal state; otherwise recompute.
  const status: ClientPackageStatus =
    pkg.status === "refunded" || pkg.status === "cancelled" ? pkg.status : packStatusAfter(after, input.now)
  await updateClientPackage(pkg.id, { credits_used: newUsed, status })

  return { ok: true }
}

/** Promote a pending pack to paid+active (Stripe webhook / cash confirmation). */
export async function activatePaidPackage(pkg: ClientPackage, stripePaymentId: string | null): Promise<ClientPackage> {
  return updateClientPackage(pkg.id, {
    payment_status: "paid",
    status: "active",
    stripe_payment_id: stripePaymentId ?? pkg.stripe_payment_id,
  })
}
