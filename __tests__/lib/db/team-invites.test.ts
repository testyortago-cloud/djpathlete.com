import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}))

import {
  generateInviteToken,
  createInvite,
  inviteStatus,
} from "@/lib/db/team-invites"
import type { TeamInvite } from "@/types/database"

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
  it("inserts an invite with a 7-day expiry, normalized email, and a generated token", async () => {
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
    expect(args.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const expiresAt = new Date(args.expires_at).getTime()
    const now = Date.now()
    expect(expiresAt - now).toBeGreaterThan(6.99 * 86400 * 1000)
    expect(expiresAt - now).toBeLessThan(7.01 * 86400 * 1000)
  })
})

describe("inviteStatus", () => {
  const base: Omit<TeamInvite, "used_at" | "expires_at"> = {
    id: "i", email: "e@x.com", role: "editor", token: "t",
    invited_by: null, created_at: "2026-01-01T00:00:00Z",
  }
  it("returns 'accepted' when used_at is set", () => {
    expect(inviteStatus({ ...base, used_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" }))
      .toBe("accepted")
  })
  it("returns 'expired' when expires_at is in the past and used_at is null", () => {
    expect(inviteStatus({ ...base, used_at: null, expires_at: "2000-01-01T00:00:00Z" }))
      .toBe("expired")
  })
  it("returns 'pending' when expires_at is in the future and used_at is null", () => {
    expect(inviteStatus({ ...base, used_at: null, expires_at: "2099-01-01T00:00:00Z" }))
      .toBe("pending")
  })
})
