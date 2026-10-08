// @vitest-environment node
//
// The "email-code" sign-in: email + 6 digits. It must let in only an account
// that can already sign in, only with a code verifyLoginCode accepts, and
// hand NextAuth the same session shape the password form does.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  verify: vi.fn(),
  audit: vi.fn(),
}))

vi.mock("@/lib/supabase", async () => {
  const { createTableFake } = await import("../helpers/table-fake")
  return { createServiceRoleClient: () => createTableFake({ users: mocks.users }) }
})
vi.mock("@/lib/db/login-codes", () => ({ verifyLoginCode: (...a: unknown[]) => mocks.verify(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: (...a: unknown[]) => mocks.audit(...a) }))

import { authorizeEmailCode } from "@/lib/auth-providers"

const LEO = {
  id: "u1",
  email: "leo@example.com",
  first_name: "Leo",
  last_name: "Sayag",
  role: "client",
  permissions: null,
  password_hash: "hash",
}
const reasons = () =>
  mocks.audit.mock.calls.map(([a]) => (a as { metadata: { reason?: string } }).metadata.reason).filter(Boolean)

beforeEach(() => {
  mocks.users.length = 0
  mocks.users.push({ ...LEO }, { ...LEO, id: "u2", email: "lead@example.com", password_hash: null })
  mocks.verify.mockReset().mockResolvedValue("ok")
  mocks.audit.mockReset()
})

describe("authorizeEmailCode", () => {
  it("signs in with the right code, as the password form would", async () => {
    expect(await authorizeEmailCode({ email: "leo@example.com", code: "042917" })).toEqual({
      id: "u1",
      email: "leo@example.com",
      name: "Leo Sayag",
      role: "client",
      permissions: {},
    })
    expect(mocks.verify).toHaveBeenCalledWith("u1", "042917")
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login_succeeded", metadata: { method: "email_code" } }),
    )
  })

  it("refuses a code verifyLoginCode does not accept, and says why in the audit log", async () => {
    mocks.verify.mockResolvedValue("expired")
    expect(await authorizeEmailCode({ email: "leo@example.com", code: "042917" })).toBeNull()
    expect(reasons()).toEqual(["code_expired"])
  })

  it("never checks a code for an unknown email or a lead with no password", async () => {
    expect(await authorizeEmailCode({ email: "nobody@example.com", code: "042917" })).toBeNull()
    expect(await authorizeEmailCode({ email: "lead@example.com", code: "042917" })).toBeNull()
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(reasons()).toEqual(["user_not_found", "lead_no_password"])
  })

  it("records a failed lookup as a lookup failure, not as an unknown user", async () => {
    mocks.users.push({ ...LEO, id: "dup" }) // two rows for one email: maybeSingle errors
    expect(await authorizeEmailCode({ email: "leo@example.com", code: "042917" })).toBeNull()
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(reasons()).toEqual(["lookup_failed"])
  })

  it("ignores anything that is not exactly six digits", async () => {
    for (const code of ["12345", "1234567", "abcdef", "", undefined]) {
      expect(await authorizeEmailCode({ email: "leo@example.com", code })).toBeNull()
    }
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
