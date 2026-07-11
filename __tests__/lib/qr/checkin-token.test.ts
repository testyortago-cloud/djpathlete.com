import { describe, it, expect, beforeAll } from "vitest"
import { signCheckinToken, verifyCheckinToken, signPersonalCheckinToken } from "@/lib/qr/checkin-token"
import { signAthleteProfileToken } from "@/lib/profile-share/token"

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret"
})

describe("checkin token", () => {
  it("round-trips a valid token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-13T00:00:00Z"))
    const r = verifyCheckinToken(t, new Date("2026-06-13T10:00:00Z"))
    expect(r).toEqual({ valid: true, coachId: "coach-1" })
  })
  it("accepts a same-day token a few hours later", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-13T08:00:00Z"))
    expect(verifyCheckinToken(t, new Date("2026-06-13T18:00:00Z")).valid).toBe(true)
  })

  it("rejects a token more than a day old", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-12T00:00:00Z"))
    expect(verifyCheckinToken(t, new Date("2026-06-13T10:00:00Z")).valid).toBe(false)
  })
  it("rejects a tampered token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-13T00:00:00Z"))
    expect(verifyCheckinToken(t + "x", new Date("2026-06-13T10:00:00Z")).valid).toBe(false)
  })
  it("rejects a malformed token", () => {
    expect(verifyCheckinToken("garbage", new Date()).valid).toBe(false)
  })
  it("rejects a stale token", () => {
    const t = signCheckinToken("coach-1", new Date("2026-06-01T00:00:00Z"))
    expect(verifyCheckinToken(t, new Date("2026-06-13T00:00:00Z")).valid).toBe(false)
  })

  // Other HMAC token families share the secret; their non-date second segment
  // yields NaN age. The coach verifier must never cross-validate them —
  // it gates the public roster + check-in endpoints.
  it("rejects an athlete-profile (ap.) token", () => {
    const t = signAthleteProfileToken("3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c")
    expect(verifyCheckinToken(t, new Date("2026-06-13T00:00:00Z")).valid).toBe(false)
  })
  it("rejects a personal check-in (pc.) token", () => {
    const t = signPersonalCheckinToken("3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c")
    expect(verifyCheckinToken(t, new Date("2026-06-13T00:00:00Z")).valid).toBe(false)
  })
})
