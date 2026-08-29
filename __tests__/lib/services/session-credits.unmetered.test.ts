import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/lib/db/client-packages")
vi.mock("@/lib/db/session-checkins")
vi.mock("@/lib/db/attendance-arrangements")
vi.mock("@/lib/services/program-progression", () => ({
  handleCheckinProgramAdvance: vi.fn(async () => ({ programCompleted: false })),
  handleVoidProgramRevert: vi.fn(async () => undefined),
}))
vi.mock("@/lib/services/pack-renewal", () => ({ attemptPackRenewal: vi.fn(async () => ({ renewed: false })) }))

import * as packs from "@/lib/db/client-packages"
import * as checkins from "@/lib/db/session-checkins"
import * as arrangements from "@/lib/db/attendance-arrangements"
import { checkInClient, voidCheckinAndRestore } from "@/lib/services/session-credits"

const ARRANGEMENT = { id: "arr1", client_user_id: "c1", status: "active" }

// resetAllMocks, not clearAllMocks: a leaked *Once implementation would cross
// into the next test and misattribute the failure.
beforeEach(() => vi.resetAllMocks())

function armArrangement() {
  vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
  vi.mocked(arrangements.getActiveArrangementForClient).mockResolvedValue(ARRANGEMENT as never)
  vi.mocked(checkins.recentNonVoidedForArrangement).mockResolvedValue(null)
  vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)
}

describe("checkInClient — attendance arrangements", () => {
  it("does NOT reach for an arrangement unless the caller opts in", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
    vi.mocked(arrangements.getActiveArrangementForClient).mockResolvedValue(ARRANGEMENT as never)

    const r = await checkInClient({ clientUserId: "c1", method: "qr_self", createdBy: null, now: new Date() })

    expect(r).toEqual({ ok: false, reason: "no_credits" })
    // The self-serve doors must not even ask — this is the whole coach-tap-only ruling.
    expect(arrangements.getActiveArrangementForClient).not.toHaveBeenCalled()
    expect(checkins.createCheckin).not.toHaveBeenCalled()
  })

  it("records attendance when the caller opts in and the client has an arrangement", async () => {
    armArrangement()

    const r = await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date("2026-08-29T15:00:00Z"),
      allowUnmetered: true,
    })

    expect(r.ok).toBe(true)
    expect(r.unmetered).toBe(true)
    expect(r.arrangementId).toBe("arr1")
    // No balance is reported, because there is none.
    expect(r.remaining).toBeUndefined()
  })

  it("writes a ledger row that burns no credit and names the arrangement", async () => {
    armArrangement()

    await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date("2026-08-29T15:00:00Z"),
      allowUnmetered: true,
    })

    expect(checkins.createCheckin).toHaveBeenCalledTimes(1)
    const row = vi.mocked(checkins.createCheckin).mock.calls[0][0]
    // Assert the VALUES, not merely that a row was written.
    expect(row.credit_delta).toBe(0)
    expect(row.arrangement_id).toBe("arr1")
    expect(row.client_package_id).toBeNull()
    expect(row.session_date).toBe("2026-08-29")
    expect(row.method).toBe("coach_tap")
  })

  it("never touches the credit ledger on the attendance path", async () => {
    armArrangement()

    await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date(),
      allowUnmetered: true,
    })

    expect(packs.casBumpCreditUsed).not.toHaveBeenCalled()
    expect(packs.updateClientPackage).not.toHaveBeenCalled()
  })

  it("refuses when the client has neither a pack nor an arrangement", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
    vi.mocked(arrangements.getActiveArrangementForClient).mockResolvedValue(null)

    const r = await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date(),
      allowUnmetered: true,
    })

    expect(r).toEqual({ ok: false, reason: "no_credits" })
    expect(checkins.createCheckin).not.toHaveBeenCalled()
  })

  it("is idempotent within the window — a double tap is one session", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
    vi.mocked(arrangements.getActiveArrangementForClient).mockResolvedValue(ARRANGEMENT as never)
    vi.mocked(checkins.recentNonVoidedForArrangement).mockResolvedValue({ id: "existing" } as never)

    const r = await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date(),
      allowUnmetered: true,
    })

    expect(r.ok).toBe(true)
    expect(r.reason).toBe("duplicate")
    expect(r.checkin).toEqual({ id: "existing" })
    expect(checkins.createCheckin).not.toHaveBeenCalled()
  })

  it("spends a paid pack before it considers the free arrangement", async () => {
    // A client who moved onto an arrangement while an old pack still has
    // credits: the credits they paid for must burn first.
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 3,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({ id: "p1", credits_used: 4 } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const r = await checkInClient({
      clientUserId: "c1",
      method: "coach_tap",
      createdBy: "coach",
      now: new Date(),
      allowUnmetered: true,
    })

    expect(r.unmetered).toBeUndefined()
    expect(r.remaining).toBe(6)
    expect(arrangements.getActiveArrangementForClient).not.toHaveBeenCalled()
    expect(vi.mocked(checkins.createCheckin).mock.calls[0][0].client_package_id).toBe("p1")
  })
})

describe("voidCheckinAndRestore — attendance check-ins", () => {
  it("voids an attendance check-in without trying to restore a credit", async () => {
    vi.mocked(checkins.getCheckinById).mockResolvedValue({
      id: "ck1",
      client_package_id: null,
      arrangement_id: "arr1",
      voided: false,
      workout_session_id: null,
    } as never)
    vi.mocked(checkins.voidCheckin).mockResolvedValue({ id: "ck1" } as never)

    const r = await voidCheckinAndRestore({ checkinId: "ck1", voidedBy: "coach", reason: "mistake", now: new Date() })

    expect(r).toEqual({ ok: true })
    expect(checkins.voidCheckin).toHaveBeenCalledTimes(1)
    // Presence control for the absence assertions: the void really did run,
    // so "no pack was read" is about the pack, not about nothing happening.
    expect(packs.getClientPackageByIdMaybe).not.toHaveBeenCalled()
    expect(packs.updateClientPackage).not.toHaveBeenCalled()
  })

  it("still restores the credit when the check-in came off a pack", async () => {
    vi.mocked(checkins.getCheckinById).mockResolvedValue({
      id: "ck2",
      client_package_id: "p1",
      arrangement_id: null,
      voided: false,
      workout_session_id: null,
    } as never)
    vi.mocked(checkins.voidCheckin).mockResolvedValue({ id: "ck2" } as never)
    vi.mocked(packs.getClientPackageByIdMaybe).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 4,
      expires_at: null,
      status: "active",
      assignment_id: null,
    } as never)
    vi.mocked(packs.updateClientPackage).mockResolvedValue({ id: "p1" } as never)

    const r = await voidCheckinAndRestore({ checkinId: "ck2", voidedBy: "coach", reason: null, now: new Date() })

    expect(r.ok).toBe(true)
    expect(packs.getClientPackageByIdMaybe).toHaveBeenCalledWith("p1")
  })
})
