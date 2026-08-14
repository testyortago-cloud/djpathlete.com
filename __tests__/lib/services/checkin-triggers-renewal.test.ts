import { vi, describe, it, expect, beforeEach } from "vitest"

const attemptPackRenewal = vi.fn()
vi.mock("@/lib/services/pack-renewal", () => ({ attemptPackRenewal }))
vi.mock("@/lib/db/client-packages")
vi.mock("@/lib/db/session-checkins")
vi.mock("@/lib/services/program-progression", () => ({
  handleCheckinProgramAdvance: vi.fn(async () => ({ programCompleted: false })),
  handleVoidProgramRevert: vi.fn(async () => undefined),
}))

import * as packs from "@/lib/db/client-packages"
import * as checkins from "@/lib/db/session-checkins"

describe("check-in triggers renewal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    attemptPackRenewal.mockResolvedValue({ renewed: true })
  })

  it("attempts renewal when the check-in depletes the pack", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 2,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 3,
      status: "depleted",
    } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const { checkInClient } = await import("@/lib/services/session-credits")
    const result = await checkInClient({
      clientUserId: "u1",
      method: "coach_tap",
      createdBy: null,
      now: new Date(),
    })

    expect(result.ok).toBe(true)
    expect(attemptPackRenewal).toHaveBeenCalled()
  })

  it("does not attempt renewal when credits remain", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 3,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({
      id: "p1",
      credits_total: 10,
      credits_used: 4,
      status: "active",
    } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)

    const { checkInClient } = await import("@/lib/services/session-credits")
    await checkInClient({ clientUserId: "u1", method: "coach_tap", createdBy: null, now: new Date() })

    expect(attemptPackRenewal).not.toHaveBeenCalled()
  })

  it("still returns ok when renewal throws — attendance is the primary record", async () => {
    vi.mocked(packs.getActivePackageForClient).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 2,
      expires_at: null,
    } as never)
    vi.mocked(checkins.recentNonVoidedForPackage).mockResolvedValue(null)
    vi.mocked(packs.casBumpCreditUsed).mockResolvedValue({
      id: "p1",
      credits_total: 3,
      credits_used: 3,
      status: "depleted",
    } as never)
    vi.mocked(checkins.createCheckin).mockResolvedValue({ id: "ck1" } as never)
    attemptPackRenewal.mockRejectedValue(new Error("stripe exploded"))

    const { checkInClient } = await import("@/lib/services/session-credits")
    const result = await checkInClient({
      clientUserId: "u1",
      method: "coach_tap",
      createdBy: null,
      now: new Date(),
    })

    expect(result.ok).toBe(true)
  })
})
