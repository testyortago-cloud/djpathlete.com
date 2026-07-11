import { describe, it, expect } from "vitest"
import { signAthleteProfileToken, verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { signPersonalCheckinToken } from "@/lib/qr/checkin-token"

describe("athlete profile token", () => {
  const uid = "3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c"

  it("round-trips a client user id", () => {
    const token = signAthleteProfileToken(uid)
    expect(verifyAthleteProfileToken(token)).toEqual({ valid: true, clientUserId: uid })
  })

  it("rejects a tampered signature", () => {
    const token = signAthleteProfileToken(uid)
    const [b64] = token.split(".")
    expect(verifyAthleteProfileToken(`${b64}.AAAA${"B".repeat(39)}`)).toEqual({ valid: false })
  })

  it("rejects a tampered payload", () => {
    const token = signAthleteProfileToken(uid)
    const [, sig] = token.split(".")
    const forged = Buffer.from(`ap.someone-else`).toString("base64url")
    expect(verifyAthleteProfileToken(`${forged}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a personal check-in token (pc. prefix) even though HMAC construction matches", () => {
    const checkin = signPersonalCheckinToken(uid)
    expect(verifyAthleteProfileToken(checkin)).toEqual({ valid: false })
  })

  it("rejects garbage", () => {
    expect(verifyAthleteProfileToken("")).toEqual({ valid: false })
    expect(verifyAthleteProfileToken("abc")).toEqual({ valid: false })
    expect(verifyAthleteProfileToken("a.b.c")).toEqual({ valid: false })
  })
})
