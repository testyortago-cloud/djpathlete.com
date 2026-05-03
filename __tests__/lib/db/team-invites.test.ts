import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const selectMock = vi.fn()
const updateMock = vi.fn()
const eqMock = vi.fn()
const singleMock = vi.fn()
const orderMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      select: selectMock,
      update: updateMock,
    }),
  }),
}))

import {
  generateInviteToken,
  createInvite,
  getInviteByToken,
  listInvites,
  markInviteUsed,
  revokeInvite,
} from "@/lib/db/team-invites"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("generateInviteToken", () => {
  it("returns a 32+ character base64url-style token", () => {
    const t = generateInviteToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(t.length).toBeGreaterThanOrEqual(32)
  })
  it("returns a different token each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken())
  })
})

describe("createInvite", () => {
  it("inserts an invite with a 7-day expiry", async () => {
    const fakeRow = { id: "inv-1", email: "k@example.com", role: "editor" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: fakeRow, error: null }) }),
    })
    const result = await createInvite({
      email: "k@example.com", role: "editor", invitedBy: "user-1",
    })
    expect(result).toEqual(fakeRow)
    const args = insertMock.mock.calls[0][0]
    expect(args.email).toBe("k@example.com")
    expect(args.role).toBe("editor")
    expect(args.invited_by).toBe("user-1")
    const expiresAt = new Date(args.expires_at).getTime()
    const now = Date.now()
    expect(expiresAt - now).toBeGreaterThan(6.9 * 86400 * 1000)
    expect(expiresAt - now).toBeLessThan(7.1 * 86400 * 1000)
  })
})
