// @vitest-environment node
//
// POST /api/auth/login-code emails a sign-in code to an account that can
// already sign in, and answers every caller the same way so nobody can use it
// to learn which emails have accounts.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; first_name: string; password_hash: string | null },
  issue: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/db/users", () => ({ getUserByEmail: vi.fn(async () => mocks.user) }))
vi.mock("@/lib/db/login-codes", () => ({ issueLoginCode: (...a: unknown[]) => mocks.issue(...a) }))
vi.mock("@/lib/email", () => ({ sendLoginCodeEmail: (...a: unknown[]) => mocks.send(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn(async () => undefined) }))

import { POST } from "@/app/api/auth/login-code/route"

const LEO = { id: "u1", email: "leo@example.com", first_name: "Leo", password_hash: "hash" }

async function post(body: unknown) {
  const res = await POST(
    new Request("http://localhost/api/auth/login-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  mocks.user = null
  mocks.issue.mockReset().mockResolvedValue({ status: "issued", code: "042917" })
  mocks.send.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/auth/login-code", () => {
  it("emails the code to an account that can sign in", async () => {
    mocks.user = LEO
    const res = await post({ email: " leo@example.com " })
    expect(res).toEqual({ status: 200, body: { success: true } })
    expect(mocks.issue).toHaveBeenCalledWith("u1")
    expect(mocks.send).toHaveBeenCalledWith("leo@example.com", "042917", "Leo")
  })

  it("answers an unknown email exactly as it answers a real one, and sends nothing", async () => {
    const res = await post({ email: "nobody@example.com" })
    expect(res).toEqual({ status: 200, body: { success: true } })
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("sends nothing to a lead with no password", async () => {
    mocks.user = { ...LEO, password_hash: null }
    const res = await post({ email: "leo@example.com" })
    expect(res).toEqual({ status: 200, body: { success: true } })
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("sends nothing inside the cooldown, and still answers the same", async () => {
    mocks.user = LEO
    mocks.issue.mockResolvedValue({ status: "cooldown" })
    const res = await post({ email: "leo@example.com" })
    expect(res).toEqual({ status: 200, body: { success: true } })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it("refuses something that is not an email", async () => {
    expect((await post({ email: "leo" })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
    expect(mocks.issue).not.toHaveBeenCalled()
  })
})
