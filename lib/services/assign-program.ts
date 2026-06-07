import type {
  AssignmentPaymentStatus,
  PaymentType,
  ProgramAssignment,
  ProgramWeekAccess,
} from "@/types/database"
import { getProgramById } from "@/lib/db/programs"
import { getPremiumWeeks } from "@/lib/db/program-week-pricing"
import { createAssignment, getAssignmentByUserAndProgram } from "@/lib/db/assignments"
import { createWeekAccessBulk } from "@/lib/db/week-access"
import { getUserById } from "@/lib/db/users"
import { sendProgramReadyEmail } from "@/lib/email"

type NewWeekAccessRow = Omit<ProgramWeekAccess, "id" | "created_at" | "updated_at">

/** Pure: entry payment type + complimentary flag -> assignment payment_status. */
export function computeAssignmentPaymentStatus(
  paymentType: PaymentType,
  complimentary: boolean,
): AssignmentPaymentStatus {
  if (complimentary || paymentType === "free") return "not_required"
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

export interface AssignProgramInput {
  programId: string
  userId: string
  startDate: string
  notes?: string | null
  assignedBy?: string | null
  complimentary?: boolean
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
  } = input

  const existing = await getAssignmentByUserAndProgram(userId, programId)
  if (existing && existing.status === "active") return { assignment: null, skipped: true }

  const program = await getProgramById(programId)
  const premiumWeeks = await getPremiumWeeks(programId)
  const totalWeeks = program.duration_weeks ?? 1
  const paymentStatus = computeAssignmentPaymentStatus(program.payment_type, complimentary)

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
