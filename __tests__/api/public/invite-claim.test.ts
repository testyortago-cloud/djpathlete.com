import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/team-invites", () => ({
  getInviteByToken: vi.fn(),
  inviteStatus: vi.fn(),
  markInviteUsed: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
}))

import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { POST } from "@/app/api/public/invite/[token]/claim/route"

beforeEach(() => vi.clearAllMocks())

const ok = (body: unknown) =>
  new Request("http://localhost/api/public/invite/tok/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const params = Promise.resolve({ token: "tok" })

describe("POST /api/public/invite/[token]/claim", () => {
  it("404s if invite missing", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(404)
  })

  it("410s if invite expired", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2000-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("expired")
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(410)
  })

  it("409s if email already exists", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2099-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
    ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" })
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(409)
  })

  it("creates user, marks invite used, returns 201", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2099-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
    ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "newU", email: "k@example.com", role: "editor",
    })
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(createUser).toHaveBeenCalled()
    expect(markInviteUsed).toHaveBeenCalledWith("i1")
  })
})
