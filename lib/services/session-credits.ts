import type {
  ClientPackage,
  ClientPackageStatus,
  PackReminderThreshold,
  CheckinMethod,
  SessionCheckin,
  PackPaymentMethod,
  PackPaymentStatus,
} from "@/types/database"
import {
  getActivePackageForClient,
  getClientPackageByIdMaybe,
  casBumpCreditUsed,
  updateClientPackage,
} from "@/lib/db/client-packages"
import {
  createCheckin,
  getCheckinById,
  recentNonVoidedForPackage,
  voidCheckin,
} from "@/lib/db/session-checkins"
import { handleCheckinProgramAdvance, handleVoidProgramRevert } from "@/lib/services/program-progression"
import { attemptPackRenewal } from "@/lib/services/pack-renewal"

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

/** Pure: build the client_packages insert payload from sell inputs. cash→paid,
 *  comp→not_required, stripe→pending (webhook promotes). Pack is usable
 *  immediately (status active) so a coach can start using it before the link is paid. */
export function buildPackageInsert(opts: {
  clientUserId: string
  productId: string | null
  assignmentId?: string | null
  sessionType: string
  credits: number
  priceCents: number
  validityDays: number | null
  paymentMethod: PackPaymentMethod
  /** Cash sales only: credits are usable now, payment (Venmo etc.) still owed. */
  owed?: boolean
  createdBy: string | null
  now: Date
  stripeSessionId?: string | null
  notes?: string | null
  /** Addressee for this pack's Stripe link; null = household payer, else the client. */
  billToEmail?: string | null
  /** Consent captured on the checkout checkbox. Recorded on the PENDING pack
   *  immediately — not deferred to the webhook — so a link re-mint before
   *  payment (resolvePackPaymentLink / changePackBillTo, via checkoutOptsFor)
   *  can read it back and carry the consent forward instead of silently
   *  dropping it. */
  autoRenew?: boolean
}): Omit<ClientPackage, "id" | "created_at" | "updated_at"> {
  const purchasedAt = opts.now.toISOString()
  const paymentStatus: PackPaymentStatus =
    opts.paymentMethod === "comp"
      ? "not_required"
      : opts.paymentMethod === "cash"
        ? opts.owed
          ? "pending"
          : "paid"
        : "pending"
  return {
    client_user_id: opts.clientUserId,
    product_id: opts.productId,
    assignment_id: opts.assignmentId ?? null,
    session_type: opts.sessionType,
    credits_total: opts.credits,
    credits_used: 0,
    price_cents: opts.priceCents,
    payment_method: opts.paymentMethod,
    payment_status: paymentStatus,
    stripe_session_id: opts.stripeSessionId ?? null,
    stripe_payment_id: null,
    purchased_at: purchasedAt,
    expires_at: expiresAtFrom(purchasedAt, opts.validityDays),
    status: "active",
    last_reminded_threshold: null,
    notes: opts.notes ?? null,
    bill_to_email: opts.billToEmail ?? null,
    // Never pre-stamped: a non-null value here would make the UI claim a link
    // was emailed that never was.
    bill_to_emailed_at: null,
    auto_renew: opts.autoRenew ?? false,
    renewed_from_package_id: null,
    renewal_attempted_at: null,
    created_by: opts.createdBy,
  }
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
  programCompleted?: boolean
}

/**
 * Deduct one credit from a client's oldest active pack.
 * - No active pack with credits → { ok:false, reason:"no_credits" }.
 * - A non-voided check-in already exists within the idempotency window →
 *   { ok:true, reason:"duplicate" } (returns the existing one, no double-deduct).
 */
export async function checkInClient(input: CheckInInput): Promise<CheckInResult> {
  const windowMs = input.idempotencyWindowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS
  const since = new Date(input.now.getTime() - windowMs).toISOString()

  // Re-read + retry on a lost CAS so a concurrent check-in can't double-deduct.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pkg = await getActivePackageForClient(input.clientUserId, input.now.toISOString())
    if (!pkg) return { ok: false, reason: "no_credits" }

    const recent = await recentNonVoidedForPackage(pkg.id, since)
    if (recent) {
      return { ok: true, reason: "duplicate", checkin: recent, remaining: remainingCredits(pkg), packageId: pkg.id }
    }

    const after = { credits_total: pkg.credits_total, credits_used: pkg.credits_used + 1, expires_at: pkg.expires_at }
    const status = packStatusAfter(after, input.now)

    // Reserve the credit atomically BEFORE writing the ledger row. If another
    // writer moved credits_used first, casBumpCreditUsed returns null → retry.
    const swapped = await casBumpCreditUsed(pkg.id, pkg.credits_used, status)
    if (!swapped) continue

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
      workout_session_id: null,
      created_by: input.createdBy,
      notes: null,
    })

    // If this pack is linked to a program, advance it (best-effort: a program-side
    // failure must never fail the check-in — attendance/credit is the primary record).
    let programCompleted = false
    if (pkg.assignment_id) {
      try {
        const r = await handleCheckinProgramAdvance({
          checkinId: checkin.id,
          assignmentId: pkg.assignment_id,
          clientUserId: input.clientUserId,
          sessionDate: input.sessionDate ?? input.now.toISOString().slice(0, 10),
        })
        programCompleted = r.programCompleted
      } catch (err) {
        console.error("[checkInClient] program advance failed:", err)
      }
    }

    // The pack just ran out. Kick off the renewal charge WITHOUT awaiting it:
    // the check-in has already succeeded, and Stripe latency must never sit in
    // the door-open path. A renewal failure can never fail a check-in.
    if (status === "depleted") {
      void attemptPackRenewal({ ...swapped }, input.now).catch((err) => {
        console.error("[session-credits] auto-renewal failed:", err)
      })
    }

    return { ok: true, checkin, remaining: remainingCredits(after), packageId: pkg.id, programCompleted }
  }

  // Lost the CAS twice under contention — treat conservatively as no credits.
  return { ok: false, reason: "no_credits" }
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

  // Pack may have been deleted (FK cascade would also remove the checkin, so this
  // is rare) — if it's gone, the void stands and there's nothing to restore.
  const pkg = await getClientPackageByIdMaybe(checkin.client_package_id)
  if (!pkg) return { ok: true }

  // Reverse the program advance this check-in made (reopen the day), best-effort.
  if (checkin.workout_session_id && pkg.assignment_id) {
    try {
      await handleVoidProgramRevert({
        workoutSessionId: checkin.workout_session_id,
        assignmentId: pkg.assignment_id,
      })
    } catch (err) {
      console.error("[voidCheckinAndRestore] program revert failed:", err)
    }
  }

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
