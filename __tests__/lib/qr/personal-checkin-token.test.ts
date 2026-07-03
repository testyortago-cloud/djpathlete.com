import { describe, it, expect } from "vitest"
import { signPersonalCheckinToken, verifyPersonalCheckinToken } from "@/lib/qr/checkin-token"

const CLIENT = "5e7bdb51-594d-42b9-b821-4ee15dcde501"

describe("personal (stable, per-client) check-in token", () => {
  it("round-trips the client id", () => {
    const token = signPersonalCheckinToken(CLIENT)
    expect(verifyPersonalCheckinToken(token)).toEqual({ valid: true, clientUserId: CLIENT })
  })

  it("is stable (no time component) — same input yields the same token", () => {
    expect(signPersonalCheckinToken(CLIENT)).toBe(signPersonalCheckinToken(CLIENT))
  })

  it("rejects a tampered token", () => {
    const token = signPersonalCheckinToken(CLIENT)
    expect(verifyPersonalCheckinToken(token.slice(0, -2) + "xx")).toEqual({ valid: false })
  })

  it("rejects a malformed token", () => {
    expect(verifyPersonalCheckinToken("garbage")).toEqual({ valid: false })
  })

  it("does not validate a coach daily token as a personal token", async () => {
    const { signCheckinToken } = await import("@/lib/qr/checkin-token")
    const coachToken = signCheckinToken("coach-1", new Date("2026-06-30T00:00:00Z"))
    expect(verifyPersonalCheckinToken(coachToken)).toEqual({ valid: false })
  })
})
