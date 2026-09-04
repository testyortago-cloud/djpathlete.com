// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted so the class exists by the time the factory below (which names
// it) is invoked -- mock factories are hoisted above this file's own
// top-level statements.
const { NoAccessibleBusinessError } = vi.hoisted(() => {
  class NoAccessibleBusinessError extends Error {
    constructor() {
      super("This account has no business it can access")
      this.name = "NoAccessibleBusinessError"
    }
  }
  return { NoAccessibleBusinessError }
})

const createInviteCalls: Array<Record<string, unknown>> = []
let createInviteImpl: (input: Record<string, unknown>) => Promise<unknown> = (input) => {
  createInviteCalls.push(input)
  return Promise.resolve({ id: "inv1", email: input.email, token: "tok", business_role: input.businessRole })
}
vi.mock("@/lib/db/team-invites", () => ({
  createInvite: (input: Record<string, unknown>) => createInviteImpl(input),
}))

const removeCalls: Array<{ businessId: string; userId: string }> = []
let countMembersImpl: (id: string) => Promise<number> = () => Promise.resolve(2)
vi.mock("@/lib/db/business-members", () => ({
  removeBusinessMember: (businessId: string, userId: string) => {
    removeCalls.push({ businessId, userId })
    return Promise.resolve()
  },
  countBusinessMembers: (id: string) => countMembersImpl(id),
}))

vi.mock("@/lib/db/businesses", () => ({
  getBusiness: (id: string) => Promise.resolve({ id, name: "B", slug: "b", status: "active" }),
}))

const deleteUserCalls: string[] = []
vi.mock("@/lib/db/users", () => ({
  deleteUser: (id: string) => { deleteUserCalls.push(id); return Promise.resolve() },
}))

let tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
let resolveImpl: () => Promise<unknown> = () => Promise.resolve(tenant)
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: () => resolveImpl(),
  NoAccessibleBusinessError,
}))

let session: unknown = { user: { id: "u1", role: "staff" } }
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(session) }))

const auditCalls: Array<Record<string, unknown>> = []
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (input: Record<string, unknown>) => { auditCalls.push(input); return Promise.resolve() },
}))

import { POST, DELETE } from "@/app/api/admin/businesses/[id]/members/route"

function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/businesses/bbb/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function deleteReq(body: unknown) {
  return new Request("http://localhost/api/admin/businesses/bbb/members", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  createInviteCalls.length = 0
  removeCalls.length = 0
  deleteUserCalls.length = 0
  auditCalls.length = 0
  countMembersImpl = () => Promise.resolve(2)
  tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
  resolveImpl = () => Promise.resolve(tenant)
  session = { user: { id: "u1", role: "staff" } }
  createInviteImpl = (input: Record<string, unknown>) => {
    createInviteCalls.push(input)
    return Promise.resolve({ id: "inv1", email: input.email, token: "tok", business_role: input.businessRole })
  }
})

describe("POST /api/admin/businesses/[id]/members", () => {
  it("creates an invite scoped to the URL business id, with the businessRole and permissions from the body", async () => {
    const res = await POST(
      postReq({ email: "coach@example.com", businessRole: "coach", permissions: { clients: true } }),
      { params: Promise.resolve({ id: "bbb" }) },
    )
    expect(res.status).toBe(201)
    expect(createInviteCalls).toHaveLength(1)
    expect(createInviteCalls[0].businessId).toBe("bbb")
    expect(createInviteCalls[0].businessRole).toBe("coach")
    expect(createInviteCalls[0].permissions).toEqual({ clients: true })
    expect(createInviteCalls[0].invitedBy).toBe("u1")
  })

  it("lets the operator invite into any business, even outside their own choices", async () => {
    tenant = { businessId: "aaa", choices: [{ id: "aaa", name: "A", slug: "a" }], isOperator: true }
    const res = await POST(
      postReq({ email: "coach@example.com", businessRole: "staff", permissions: {} }),
      { params: Promise.resolve({ id: "bbb" }) },
    )
    expect(res.status).toBe(201)
    expect(createInviteCalls[0].businessId).toBe("bbb")
  })

  it("REFUSES an id outside the caller's allowed set and writes nothing", async () => {
    // The URL is caller-controlled. Without this check a coach could invite
    // someone into a business that isn't theirs by typing a different id.
    tenant = { businessId: "bbb", choices: [{ id: "bbb", name: "B", slug: "b" }], isOperator: false }
    const res = await POST(
      postReq({ email: "intruder@example.com", businessRole: "owner", permissions: {} }),
      { params: Promise.resolve({ id: "ccc" }) },
    )
    expect(res.status).toBe(403)
    expect(createInviteCalls).toHaveLength(0)
    expect(auditCalls).toHaveLength(0)
  })

  it("answers 403, not a 500, when the resolver has no accessible business", async () => {
    resolveImpl = () => Promise.reject(new NoAccessibleBusinessError())
    const res = await POST(
      postReq({ email: "coach@example.com", businessRole: "coach", permissions: {} }),
      { params: Promise.resolve({ id: "bbb" }) },
    )
    expect(res.status).toBe(403)
    expect(createInviteCalls).toHaveLength(0)
  })

  it("rejects an invalid body and writes nothing", async () => {
    const res = await POST(
      postReq({ email: "not-an-email", businessRole: "coach" }),
      { params: Promise.resolve({ id: "bbb" }) },
    )
    expect(res.status).toBe(400)
    expect(createInviteCalls).toHaveLength(0)
  })
})

describe("DELETE /api/admin/businesses/[id]/members", () => {
  it("removes the membership row for the URL business id and the given userId", async () => {
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(removeCalls).toEqual([{ businessId: "bbb", userId: "11111111-1111-4111-8111-111111111111" }])
  })

  it("pins the removal to the URL id, not tenant.businessId", async () => {
    // The operator's OWN business is "aaa"; the URL asks to remove a member
    // from "bbb". removeBusinessMember must be called with "bbb" -- the id
    // in the URL -- never "aaa".
    tenant = { businessId: "aaa", choices: [{ id: "aaa", name: "A", slug: "a" }, { id: "bbb", name: "B", slug: "b" }], isOperator: true }
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(removeCalls).toEqual([{ businessId: "bbb", userId: "11111111-1111-4111-8111-111111111111" }])
  })

  it("REFUSES an id outside the caller's allowed set and writes nothing", async () => {
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "ccc" }) })
    expect(res.status).toBe(403)
    expect(removeCalls).toHaveLength(0)
  })

  it("does NOT delete the user -- only the membership row", async () => {
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(deleteUserCalls).toHaveLength(0)
  })

  it("refuses to remove the last remaining member, with 409, and writes nothing", async () => {
    countMembersImpl = () => Promise.resolve(1)
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/only person left/i)
    expect(removeCalls).toHaveLength(0)
    expect(deleteUserCalls).toHaveLength(0)
  })

  it("allows removal when more than one member remains", async () => {
    countMembersImpl = () => Promise.resolve(2)
    const res = await DELETE(deleteReq({ userId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ id: "bbb" }) })
    expect(res.status).toBe(200)
    expect(removeCalls).toHaveLength(1)
  })
})
