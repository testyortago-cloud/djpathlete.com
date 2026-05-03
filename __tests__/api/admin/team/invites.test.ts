import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))
vi.mock("@/lib/db/team-invites", () => ({
  createInvite: vi.fn(),
  listInvites: vi.fn(),
}))
vi.mock("@/lib/email", () => ({
  sendTeamInviteEmail: vi.fn().mockResolvedValue(undefined),
}))

import { auth } from "@/lib/auth"
import { createInvite, listInvites } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"
import { POST, GET } from "@/app/api/admin/team/invites/route"

beforeEach(() => {
  vi.clearAllMocks()
})

function makeReq(body: unknown) {
  return new Request("http://localhost/api/admin/team/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/team/invites", () => {
  it("returns 401 when not authenticated", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    const res = await POST(makeReq({ email: "not-email", role: "editor" }))
    expect(res.status).toBe(400)
  })

  it("creates invite + sends email when admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin", name: "Darren Paul" },
    })
    ;(createInvite as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv1",
      email: "k@example.com",
      token: "tok123",
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    })
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(201)
    expect(createInvite).toHaveBeenCalledWith({
      email: "k@example.com", role: "editor", invitedBy: "u1",
    })
    expect(sendTeamInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "k@example.com",
        inviteUrl: expect.stringContaining("/invite/tok123"),
        inviterName: "Darren Paul",
      }),
    )
  })

  it("returns 409 when DB unique violation 23505 thrown (duplicate pending invite)", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin", name: "Darren" },
    })
    const pgErr = Object.assign(new Error("duplicate key"), { code: "23505" })
    ;(createInvite as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(pgErr)
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already/i)
  })

  it("still returns 201 when email transport throws", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin", name: "Darren Paul" },
    })
    ;(createInvite as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv1",
      email: "k@example.com",
      token: "tok123",
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    })
    ;(sendTeamInviteEmail as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Resend down"))
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(201)
  })
})

describe("GET /api/admin/team/invites", () => {
  it("returns 403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns the list for admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(listInvites as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "inv1", email: "k@example.com" },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.invites).toHaveLength(1)
  })
})
