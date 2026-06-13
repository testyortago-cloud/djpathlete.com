import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/lib/db/client-packages")
vi.mock("@/lib/db/session-checkins")

import * as packs from "@/lib/db/client-packages"
import * as checkins from "@/lib/db/session-checkins"
import { checkInClient, voidCheckinAndRestore } from "@/lib/services/session-credits"

beforeEach(() => vi.resetAllMocks())

describe("checkInClient", () => {
  it("rejects when no active package", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue(null)
    const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })
    expect(r).toEqual({ ok: false, reason: "no_credits" })
  })

  it("deducts a credit on check-in and stays active", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 3,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({ id: "p1", credits_used: 4 } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })

    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(6)
    expect(packs.casBumpCreditUsed).toHaveBeenCalledWith("p1", 3, "active")
    expect(checkins.createCheckin).toHaveBeenCalledTimes(1)
  })

  it("flips to depleted when the last credit is used", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 2,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({ id: "p1", credits_used: 3 } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const r = await checkInClient({ clientUserId: "c1", method: "qr_self", createdBy: null, now: new Date() })

    expect(r.remaining).toBe(0)
    expect(packs.casBumpCreditUsed).toHaveBeenCalledWith("p1", 2, "depleted")
  })

  it("is idempotent within the window (no double-deduct)", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 3,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue({ id: "existing" } as never)

    const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })

    expect(r).toMatchObject({ ok: true, reason: "duplicate" })
    expect(checkins.createCheckin).not.toHaveBeenCalled()
    expect(packs.casBumpCreditUsed).not.toHaveBeenCalled()
  })

  it("retries once when the CAS is lost, then succeeds without double-writing the ledger", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 3,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    // First CAS loses the race (null), second wins.
    vi.mocked(packs.casBumpCreditUsed)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: "p1", credits_used: 4 } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const r = await checkInClient({ clientUserId: "c1", method: "coach_tap", createdBy: "coach", now: new Date() })

    expect(r.ok).toBe(true)
    expect(packs.casBumpCreditUsed).toHaveBeenCalledTimes(2)
    expect(checkins.createCheckin).toHaveBeenCalledTimes(1)
  })
})

describe("voidCheckinAndRestore", () => {
  it("restores a credit and re-activates a depleted pack", async () => {
    vi.mocked(checkins.getCheckinById).mockResolvedValue({
      id: "ck1",
      client_package_id: "p1",
      voided: false,
    } as never)
    vi.mocked(checkins.voidCheckin).mockResolvedValue({} as never)
    vi.mocked(packs.getClientPackageByIdMaybe).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 3,
      expires_at: null,
      status: "depleted",
    } as never)
    vi.mocked(packs.updateClientPackage).mockResolvedValue({} as never)

    const r = await voidCheckinAndRestore({ checkinId: "ck1", voidedBy: "coach", reason: "mistake", now: new Date() })

    expect(r.ok).toBe(true)
    expect(packs.updateClientPackage).toHaveBeenCalledWith("p1", { credits_used: 2, status: "active" })
  })

  it("rejects an already-voided check-in", async () => {
    vi.mocked(checkins.getCheckinById).mockResolvedValue({ id: "ck1", voided: true } as never)
    const r = await voidCheckinAndRestore({ checkinId: "ck1", voidedBy: "coach", reason: null, now: new Date() })
    expect(r).toEqual({ ok: false, reason: "already_voided" })
    expect(checkins.voidCheckin).not.toHaveBeenCalled()
  })
})
