// @vitest-environment node
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
vi.mock("@/lib/db/business-members", () => ({
  addBusinessMember: vi.fn().mockResolvedValue("added"),
  linkHostToUser: vi.fn().mockResolvedValue(undefined),
}))

import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { addBusinessMember, linkHostToUser } from "@/lib/db/business-members"
import { POST } from "@/app/api/public/invite/[token]/claim/route"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

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

  describe("the created account's role follows the permissions that survive sanitizing", () => {
    function pendingInvite(over: Record<string, unknown>) {
      ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "i1", email: "k@example.com", expires_at: "2099-01-01", used_at: null,
        permissions: {}, staff_role: null, ...over,
      })
      ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
      ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "newU", email: "k@example.com" })
    }

    async function claim() {
      return POST(ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }), { params })
    }

    function createdWith() {
      return (createUser as ReturnType<typeof vi.fn>).mock.calls[0][0]
    }

    it("creates a staff account when the invite grants something", async () => {
      pendingInvite({ role: "staff", permissions: { clients: true }, staff_role: "coach" })

      expect((await claim()).status).toBe(201)
      expect(createdWith().role).toBe("staff")
      expect(createdWith().permissions).toEqual({ clients: true })
      expect(createdWith().staff_role).toBe("coach")
    })

    it("creates an editor account when the invite grants nothing", async () => {
      pendingInvite({ role: "editor", permissions: {}, staff_role: null })

      expect((await claim()).status).toBe(201)
      expect(createdWith().role).toBe("editor")
      expect(createdWith().staff_role).toBeNull()
    })

    it("downgrades a staff invite whose permissions no longer exist", async () => {
      // Otherwise the account is staff with an empty map, and every page they
      // open bounces to /admin/no-access.
      pendingInvite({ role: "staff", permissions: { retired_permission: true }, staff_role: "coach" })

      expect((await claim()).status).toBe(201)
      expect(createdWith().permissions).toEqual({})
      expect(createdWith().role).toBe("editor")
      expect(createdWith().staff_role).toBeNull()
    })
  })

  /**
   * Every accepted invite now writes a business_members row, because absence
   * of one means "no access" once resolveAdminTenant's compatibility branch
   * is gone (migration 00246). This is what stops step 13 from silently
   * locking out every future teammate: a plain /admin/team invite carries no
   * business_id, and without this fallback it would create a user with no
   * membership row at all.
   */
  describe("membership: every accepted invite grants a business_members row", () => {
    function pendingInvite(over: Record<string, unknown>) {
      ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "i1", email: "k@example.com", role: "editor", expires_at: "2099-01-01", used_at: null,
        permissions: {}, staff_role: null, business_id: null, business_role: null, ...over,
      })
      ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
      ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "newU", email: "k@example.com" })
    }

    async function claim() {
      return POST(ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }), { params })
    }

    it("a business-less invite (a plain /admin/team invite) still produces a singleton staff membership", async () => {
      pendingInvite({ business_id: null, business_role: null })

      expect((await claim()).status).toBe(201)
      expect(addBusinessMember).toHaveBeenCalledWith(SINGLETON_BUSINESS_ID, "newU", "staff")
      // A platform-staff invite is never a host.
      expect(linkHostToUser).not.toHaveBeenCalled()
    })

    it("a business-scoped invite grants membership in THAT business, with the invite's role", async () => {
      pendingInvite({ business_id: "biz-1", business_role: "staff" })

      expect((await claim()).status).toBe(201)
      expect(addBusinessMember).toHaveBeenCalledWith("biz-1", "newU", "staff")
      expect(linkHostToUser).not.toHaveBeenCalled()
    })

    it("a coach invite also claims the unowned host row for that business", async () => {
      pendingInvite({ business_id: "biz-1", business_role: "coach" })

      expect((await claim()).status).toBe(201)
      expect(addBusinessMember).toHaveBeenCalledWith("biz-1", "newU", "coach")
      expect(linkHostToUser).toHaveBeenCalledWith("biz-1", "newU")
    })

    it("a business-scoped invite with no business_role defaults to coach and claims the host row", async () => {
      pendingInvite({ business_id: "biz-1", business_role: null })

      expect((await claim()).status).toBe(201)
      expect(addBusinessMember).toHaveBeenCalledWith("biz-1", "newU", "coach")
      expect(linkHostToUser).toHaveBeenCalledWith("biz-1", "newU")
    })

    /**
     * The ordering fix from review round 1. markInviteUsed must run AFTER
     * the membership write, not before -- otherwise a failed addBusinessMember
     * leaves a real user account with a consumed invite and no membership
     * row, and step 13 removed the fallback that would have papered over it.
     * Asserting call ORDER alone is weaker than this: a mock can record two
     * calls in order while still having made both. What actually matters is
     * that the second call NEVER HAPPENED, which is what this pins.
     */
    it("does NOT mark the invite used when the membership write fails, so it stays retry-able", async () => {
      pendingInvite({ business_id: null, business_role: null })
      ;(addBusinessMember as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db unavailable"))

      await expect(claim()).rejects.toThrow("db unavailable")
      expect(markInviteUsed).not.toHaveBeenCalled()
    })

    it("does NOT mark the invite used when linkHostToUser fails (a coach invite)", async () => {
      pendingInvite({ business_id: "biz-1", business_role: "coach" })
      ;(linkHostToUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db unavailable"))

      await expect(claim()).rejects.toThrow("db unavailable")
      expect(markInviteUsed).not.toHaveBeenCalled()
    })
  })
})
