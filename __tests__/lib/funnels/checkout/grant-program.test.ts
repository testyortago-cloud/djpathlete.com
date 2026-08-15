// The step between "the card was charged" and "the buyer can open the program".
//
// Every case here is a way the purchase succeeds and the customer still cannot
// train — the outcome the spec calls the one that costs a customer and the
// coach's reputation at once.

import { describe, expect, it, vi } from "vitest"
import { grantProgramAccess, type ProgramGrantPorts } from "@/lib/funnels/checkout/grant-program"

function ports(overrides: Partial<ProgramGrantPorts> = {}): ProgramGrantPorts {
  return {
    assignProgram: vi.fn().mockResolvedValue({ skipped: false }),
    getAssignmentByUserAndProgram: vi.fn().mockResolvedValue(null),
    markAssignmentPaid: vi.fn().mockResolvedValue(undefined),
    today: () => "2026-08-16",
    ...overrides,
  }
}

const INPUT = { programId: "prog-1", userId: "user-1" }

describe("granting a program that has just been paid for", () => {
  it("assigns it as PREPAID, not pending", async () => {
    // MUTANT KILLED: `prepaid: false` (or omitting it). A paid program seeds
    // `payment_status: "pending"`, and `isAccessAllowed` refuses every workout
    // route while it is pending — so the buyer pays and is locked out of the
    // thing they bought. This is the single load-bearing argument in the file.
    const p = ports()
    await grantProgramAccess(INPUT, p)
    expect(p.assignProgram).toHaveBeenCalledWith({
      programId: "prog-1",
      userId: "user-1",
      startDate: "2026-08-16",
      prepaid: true,
    })
  })

  it("reports a real grant, not a skip", async () => {
    expect(await grantProgramAccess(INPUT, ports())).toEqual({ skipped: false })
  })
})

describe("when an assignment already exists", () => {
  it("PROMOTES a coach-created assignment that was awaiting payment", async () => {
    // MUTANT KILLED: trusting `skipped: true` from `assignProgram`. It skips on
    // any ACTIVE assignment without reading its payment_status, and
    // `{status: "active", payment_status: "pending"}` is precisely a client the
    // coach set up and left awaiting payment — the most likely state for
    // someone who then buys from a landing page. Trusting the skip takes the
    // money and leaves the assignment unpaid and unusable.
    const markAssignmentPaid = vi.fn().mockResolvedValue(undefined)
    const result = await grantProgramAccess(
      INPUT,
      ports({
        assignProgram: vi.fn().mockResolvedValue({ skipped: true }),
        getAssignmentByUserAndProgram: vi
          .fn()
          .mockResolvedValue({ id: "a-1", status: "active", payment_status: "pending" }),
        markAssignmentPaid,
      }),
    )

    expect(markAssignmentPaid).toHaveBeenCalledWith("a-1")
    // NOT a skip: this call is what delivered the purchase.
    expect(result).toEqual({ skipped: false })
  })

  it("reports a genuine skip when they could already train", async () => {
    const markAssignmentPaid = vi.fn()
    const result = await grantProgramAccess(
      INPUT,
      ports({
        assignProgram: vi.fn().mockResolvedValue({ skipped: true }),
        getAssignmentByUserAndProgram: vi
          .fn()
          .mockResolvedValue({ id: "a-1", status: "active", payment_status: "paid" }),
        markAssignmentPaid,
      }),
    )
    expect(result).toEqual({ skipped: true })
    expect(markAssignmentPaid).not.toHaveBeenCalled()
  })

  it("never overwrites a complimentary assignment with 'paid'", async () => {
    // `not_required` is a coach's decision to give this away. The client can
    // already train, so there is nothing to promote — and rewriting it would
    // quietly turn a gift into a sale in the record.
    const markAssignmentPaid = vi.fn()
    const result = await grantProgramAccess(
      INPUT,
      ports({
        assignProgram: vi.fn().mockResolvedValue({ skipped: true }),
        getAssignmentByUserAndProgram: vi
          .fn()
          .mockResolvedValue({ id: "a-1", status: "active", payment_status: "not_required" }),
        markAssignmentPaid,
      }),
    )
    expect(result).toEqual({ skipped: true })
    expect(markAssignmentPaid).not.toHaveBeenCalled()
  })

  it("throws rather than claim 'already owned' on a state it could not read", async () => {
    // A skip means an assignment existed, so reading nothing back is a
    // contradiction. `grant.ts` reports `alreadyOwned` to a human as "they paid
    // and already had it" — saying that about a state nobody could read would
    // close the case on a customer who may have nothing.
    await expect(
      grantProgramAccess(
        INPUT,
        ports({
          assignProgram: vi.fn().mockResolvedValue({ skipped: true }),
          getAssignmentByUserAndProgram: vi.fn().mockResolvedValue(null),
        }),
      ),
    ).rejects.toThrow(/skipped but no assignment/i)
  })
})
