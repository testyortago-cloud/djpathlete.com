// @vitest-environment node
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
  function resolveInsertWith(row: unknown) {
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
    })
  }

  it("inserts an invite with a 7-day expiry, normalized email, and a generated token", async () => {
    const fakeRow = { id: "inv-1", email: "k@example.com", role: "editor" }
    resolveInsertWith(fakeRow)

    const result = await createInvite({ email: "K@Example.com ", invitedBy: "user-1" })

    expect(result).toEqual(fakeRow)
    const args = insertMock.mock.calls[0][0]
    expect(args.email).toBe("k@example.com")
    expect(args.invited_by).toBe("user-1")
    expect(args.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const expiresAt = new Date(args.expires_at).getTime()
    const now = Date.now()
    expect(expiresAt - now).toBeGreaterThan(6.99 * 86400 * 1000)
    expect(expiresAt - now).toBeLessThan(7.01 * 86400 * 1000)
  })

  it("derives an editor invite when nothing is granted", async () => {
    resolveInsertWith({ id: "inv-1" })

    await createInvite({ email: "k@example.com", invitedBy: "user-1" })

    expect(insertMock.mock.calls[0][0].role).toBe("editor")
  })

  it("derives a staff invite from a single grant", async () => {
    resolveInsertWith({ id: "inv-2" })

    await createInvite({ email: "k@example.com", invitedBy: "user-1", permissions: { blog: true } })

    expect(insertMock.mock.calls[0][0].role).toBe("staff")
  })

  it("does not let a preset label imply access an editor invite never grants", async () => {
    // "Custom" with nothing ticked used to create a staff user whose first
    // sight of the app was /admin/no-access.
    resolveInsertWith({ id: "inv-3" })

    await createInvite({
      email: "k@example.com",
      invitedBy: "user-1",
      permissions: {},
      staffRole: "custom",
    })

    const args = insertMock.mock.calls[0][0]
    expect(args.role).toBe("editor")
    expect(args.staff_role).toBeNull()
  })

  it("sanitizes the permission map, so junk cannot promote the invite", async () => {
    resolveInsertWith({ id: "inv-4" })

    await createInvite({
      email: "k@example.com",
      invitedBy: "user-1",
      permissions: { not_a_permission: true } as never,
    })

    const args = insertMock.mock.calls[0][0]
    expect(args.permissions).toEqual({})
    expect(args.role).toBe("editor")
  })
})

describe("inviteStatus", () => {
  const base: Omit<TeamInvite, "used_at" | "expires_at"> = {
    id: "i", email: "e@x.com", role: "editor", token: "t",
    invited_by: null, created_at: "2026-01-01T00:00:00Z",
    permissions: {}, staff_role: null,
    business_id: null, business_role: null,
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
