// lib/funnels/checkout/grant-program.ts — turning a settled payment into
// working access to a program.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT JUST `assignProgram(...)`
// ---------------------------------------------------------------------------
// The spec says "grant through the gate, never around it", and `grant.ts` types
// its dependency as `assignProgram`. Both are right about WHICH function, and
// neither is sufficient, because `assignProgram` has two behaviours that turn a
// completed purchase into a locked-out customer:
//
//   1. IT SEEDS `payment_status: "pending"` for a paid program. `isAccessAllowed`
//      refuses every workout route while an assignment is pending, so the happy
//      path — card charged, assignment created — ends at "you do not have
//      access". Closed by passing `prepaid: true`, which this module owns.
//
//   2. IT SKIPS WHEN AN ACTIVE ASSIGNMENT ALREADY EXISTS, returning
//      `{skipped: true}` without looking at its payment_status. An assignment
//      the coach created by hand and left AWAITING PAYMENT is `status: "active",
//      payment_status: "pending"` — the single most likely state for someone the
//      coach has already spoken to, which is exactly who buys from a landing
//      page. `grant.ts` reads `skipped` as "they already own it, success", so
//      the money would move and the pending assignment would sit there unpaid.
//
// So `skipped` has to be interrogated rather than trusted, and that is the whole
// job of this file. The pre-existing purchase path in the Stripe webhook does
// the same promote-if-pending dance inline; this states it once, with ports, so
// it can be tested without a database.

/** Just enough of an assignment to decide whether the buyer can actually train. */
export interface AssignmentAccessState {
  id: string
  status: string
  payment_status: string
}

export interface ProgramGrantPorts {
  assignProgram: (input: {
    programId: string
    userId: string
    startDate: string
    prepaid: boolean
  }) => Promise<{ skipped: boolean }>
  getAssignmentByUserAndProgram: (userId: string, programId: string) => Promise<AssignmentAccessState | null>
  markAssignmentPaid: (assignmentId: string) => Promise<void>
  /** Injected so a test is not at the mercy of the clock. */
  today: () => string
}

export interface ProgramGrantResult {
  /**
   * True ONLY when the buyer already had working, paid-up access — never when
   * an assignment merely existed. `grant.ts` surfaces this as `alreadyOwned`,
   * and it is reported to a human, so "already owned" has to mean it.
   */
  skipped: boolean
}

/**
 * A payment_status that lets the client train. `not_required` is a
 * complimentary or free assignment: they can train, so a purchase on top is
 * genuinely redundant and must not be "promoted" to paid — that would rewrite a
 * coach's decision to give it away.
 */
function alreadyUsable(status: string): boolean {
  return status === "paid" || status === "not_required"
}

export async function grantProgramAccess(
  input: { programId: string; userId: string },
  ports: ProgramGrantPorts,
): Promise<ProgramGrantResult> {
  const assigned = await ports.assignProgram({
    programId: input.programId,
    userId: input.userId,
    startDate: ports.today(),
    // The money is in. Without this the assignment is created `pending` and the
    // buyer cannot open the thing they just paid for.
    prepaid: true,
  })

  if (!assigned.skipped) return { skipped: false }

  // `assignProgram` declined because an ACTIVE assignment exists. That is not
  // the same as "they already have access".
  const existing = await ports.getAssignmentByUserAndProgram(input.userId, input.programId)

  // No row back from a skip is a contradiction — the skip means one existed.
  // Reporting "already owned" on a state we could not read would tell the coach
  // a paying customer needed nothing. Treat it as a grant that did not happen so
  // the caller's failure path runs.
  if (!existing) throw new Error("assignProgram skipped but no assignment could be read back")

  if (alreadyUsable(existing.payment_status)) return { skipped: true }

  // The coach set this up and left it awaiting payment. The payment has now
  // arrived, so this IS the delivery — not a skip.
  await ports.markAssignmentPaid(existing.id)
  return { skipped: false }
}
