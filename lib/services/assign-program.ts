import type {
  AssignmentPaymentStatus,
  PaymentType,
  ProgramAssignment,
  ProgramWeekAccess,
} from "@/types/database"
import { getProgramById } from "@/lib/db/programs"
import { getPremiumWeeks } from "@/lib/db/program-week-pricing"
import { createAssignment, getAssignmentByUserAndProgram, getActiveAssignmentsForProgram } from "@/lib/db/assignments"
import {
  createWeekAccessBulk,
  getWeekAccessByAssignment,
  createWeekAccess,
  updateWeekAccessByAssignmentAndWeek,
} from "@/lib/db/week-access"
import { getUserById } from "@/lib/db/users"
import { sendProgramReadyEmail } from "@/lib/email"

type NewWeekAccessRow = Omit<ProgramWeekAccess, "id" | "created_at" | "updated_at">

/** Pure: entry payment type + complimentary flag -> assignment payment_status. */
export function computeAssignmentPaymentStatus(
  paymentType: PaymentType,
  complimentary: boolean,
  /**
   * THE MONEY IS ALREADY IN. Set only by a caller holding a settled payment —
   * today that is the funnel's anonymous checkout, running from the Stripe
   * webhook after `checkout.session.completed`.
   *
   * WITHOUT THIS, GRANTING A PURCHASE THROUGH `assignProgram` LOCKS THE BUYER
   * OUT OF THE THING THEY JUST BOUGHT. A paid program seeds `pending`, and
   * `isAccessAllowed` refuses every workout route while it is pending — so the
   * happy path would end in "you do not have access", which is the one outcome
   * that costs a customer and the coach's reputation together.
   *
   * The alternative is what the pre-existing purchase path does: skip
   * `assignProgram` and `createAssignment` directly with `payment_status:
   * "paid"`. That works and it is why this gap went unnoticed — but it also
   * skips this function's premium-week seeding, so a program with paid weeks
   * grants every week as included. One canonical assign path that can express
   * "already paid" beats two paths that disagree.
   */
  prepaid = false,
): AssignmentPaymentStatus {
  if (complimentary || paymentType === "free") return "not_required"
  if (prepaid) return "paid"
  // one_time and subscription both start pending; the Stripe webhook promotes them.
  return "pending"
}

/** Pure: seed week-access rows from the program's premium-week template. */
export function buildWeekAccessRows(
  assignmentId: string,
  durationWeeks: number,
  premiumWeeks: { week_number: number; price_cents: number }[],
): NewWeekAccessRow[] {
  const priceByWeek = new Map(premiumWeeks.map((w) => [w.week_number, w.price_cents]))
  return Array.from({ length: Math.max(durationWeeks, 1) }, (_, i) => {
    const week = i + 1
    const premiumPrice = priceByWeek.get(week)
    if (premiumPrice != null) {
      return {
        assignment_id: assignmentId,
        week_number: week,
        access_type: "paid" as const,
        price_cents: premiumPrice,
        payment_status: "pending" as const,
        stripe_session_id: null,
        stripe_payment_id: null,
      }
    }
    return {
      assignment_id: assignmentId,
      week_number: week,
      access_type: "included" as const,
      price_cents: null,
      payment_status: "not_required" as const,
      stripe_session_id: null,
      stripe_payment_id: null,
    }
  })
}

type WeekAccessShape = Pick<ProgramWeekAccess, "access_type" | "payment_status" | "price_cents">

/**
 * Given a client's current week-access row (or null) and the program template's
 * price for that week (null = not premium), return the target row fields — or
 * "preserve" when the row is a per-client override/purchase that resync must not touch.
 */
export function resolveWeekResync(
  current: WeekAccessShape | null,
  premiumPriceCents: number | null,
): "preserve" | { access_type: "paid" | "included"; payment_status: "pending" | "not_required"; price_cents: number | null } {
  if (
    current &&
    current.access_type === "paid" &&
    (current.payment_status === "paid" || current.payment_status === "not_required")
  ) {
    return "preserve"
  }
  if (premiumPriceCents != null) {
    return { access_type: "paid", payment_status: "pending", price_cents: premiumPriceCents }
  }
  return { access_type: "included", payment_status: "not_required", price_cents: null }
}

/**
 * Bring all active clients' per-week access into line with the program template.
 * Preserves per-client overrides (purchased or coach-granted weeks).
 */
export async function resyncProgramWeekAccess(programId: string): Promise<void> {
  const program = await getProgramById(programId)
  const totalWeeks = program.duration_weeks ?? 1
  const premiumWeeks = await getPremiumWeeks(programId)
  const priceByWeek = new Map(premiumWeeks.map((w) => [w.week_number, w.price_cents]))
  const assignments = await getActiveAssignmentsForProgram(programId)
  for (const a of assignments) {
    const rows = await getWeekAccessByAssignment(a.id)
    const byWeek = new Map(rows.map((r) => [r.week_number, r]))
    for (let week = 1; week <= totalWeeks; week++) {
      const current = byWeek.get(week) ?? null
      const target = resolveWeekResync(current, priceByWeek.get(week) ?? null)
      if (target === "preserve") continue
      if (!current) {
        await createWeekAccess({
          assignment_id: a.id,
          week_number: week,
          access_type: target.access_type,
          price_cents: target.price_cents,
          payment_status: target.payment_status,
          stripe_session_id: null,
          stripe_payment_id: null,
        })
      } else if (
        current.access_type !== target.access_type ||
        current.payment_status !== target.payment_status ||
        (current.price_cents ?? null) !== target.price_cents
      ) {
        await updateWeekAccessByAssignmentAndWeek(a.id, week, {
          access_type: target.access_type,
          price_cents: target.price_cents,
          payment_status: target.payment_status,
        })
      }
    }
  }
}

export interface AssignProgramInput {
  programId: string
  userId: string
  startDate: string
  notes?: string | null
  assignedBy?: string | null
  complimentary?: boolean
  /** The payment has already settled — see `computeAssignmentPaymentStatus`. */
  prepaid?: boolean
}

export interface AssignProgramResult {
  assignment: ProgramAssignment | null
  skipped: boolean
}

/**
 * THE single path to assign a program to a client. Every caller (admin dialog,
 * Pricing & Access sheet, any future flow) must use this so payment_status and
 * week-access are always seeded correctly. Skips clients with an existing active assignment.
 */
export async function assignProgram(input: AssignProgramInput): Promise<AssignProgramResult> {
  const {
    programId,
    userId,
    startDate,
    notes = null,
    assignedBy = null,
    complimentary = false,
    prepaid = false,
  } = input

  const existing = await getAssignmentByUserAndProgram(userId, programId)
  if (existing && existing.status === "active") return { assignment: null, skipped: true }

  const program = await getProgramById(programId)
  const premiumWeeks = await getPremiumWeeks(programId)
  const totalWeeks = program.duration_weeks ?? 1
  const paymentStatus = computeAssignmentPaymentStatus(program.payment_type, complimentary, prepaid)

  const assignment = await createAssignment({
    program_id: programId,
    user_id: userId,
    assigned_by: assignedBy,
    start_date: startDate,
    end_date: null,
    status: "active",
    notes,
    current_week: 1,
    total_weeks: totalWeeks,
    payment_status: paymentStatus,
    expires_at: null,
  })

  await createWeekAccessBulk(buildWeekAccessRows(assignment.id, totalWeeks, premiumWeeks))

  // Notify the client — best-effort, never blocks assignment.
  try {
    const client = await getUserById(userId)
    await sendProgramReadyEmail(client.email, client.first_name, program.name, userId)
  } catch (err) {
    console.error(`[assignProgram] email failed for ${userId}:`, err)
  }

  return { assignment, skipped: false }
}
