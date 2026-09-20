// @vitest-environment node
//
// G04 (ledger 2026-09-19), the admin-onboarding half. This is the door the
// coach's ACTUAL clients come through: someone takes the quiz or fills a
// form, then the coach creates their account by hand from /admin/clients.
// If that door does not link, their contact stays unlinked, `has_user`
// ("already a client") keeps saying no, and migration 00264 is one-time — so
// nothing ever repairs it.
//
// `linkContactsToUser` itself (fill-only, unscoped by design) is proven in
// __tests__/db/contacts-record-event.test.ts. This file pins only that the
// route calls it, with the id and email of the account it actually created,
// and that a link failure can never cost the coach the account.
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  linkContactsToUser: vi.fn(),
  session: null as null | { user: { id: string; role: string; email: string } },
  existingUser: null as null | Record<string, unknown>,
  createdUser: null as null | Record<string, unknown>,
}))

vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed") }))
vi.mock("@/lib/auth", () => ({ auth: async () => mocks.session }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: async () => true }))
vi.mock("@/lib/db/users", () => ({
  getUserByEmail: async () => mocks.existingUser,
  createUser: async () => mocks.createdUser,
}))
vi.mock("@/lib/db/contacts", () => ({
  linkContactsToUser: (...a: unknown[]) => mocks.linkContactsToUser(...a),
}))
vi.mock("@/lib/db/email-verification-tokens", () => ({
  createEmailVerificationToken: vi.fn(async () => "tok"),
}))
vi.mock("@/lib/email", () => ({
  sendAccountCreatedEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
}))
vi.mock("@/lib/ghl", () => ({
  ghlCreateContact: vi.fn(async () => null),
  ghlTriggerWorkflow: vi.fn(async () => undefined),
}))
vi.mock("@/lib/audit/with-audit", () => ({
  withAudit: (_cfg: unknown, handler: (req: Request) => Promise<Response>) => handler,
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: async () => ({ data: null, error: null }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  }),
}))

import { POST } from "@/app/api/admin/clients/route"

// withAudit's Handler type is (request, context). This route reads no route
// params, but the second argument is not optional.
const ctx = { params: Promise.resolve({} as Record<string, string>) }

function makeReq(over: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/admin/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Dana",
      lastName: "Okafor",
      email: "dana@example.com",
      ...over,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.linkContactsToUser.mockResolvedValue(1)
  mocks.session = { user: { id: "admin-1", role: "admin", email: "coach@example.com" } }
  mocks.existingUser = null
  mocks.createdUser = {
    id: "user-dana",
    email: "dana@example.com",
    first_name: "Dana",
    last_name: "Okafor",
    role: "client",
  }
})

describe("POST /api/admin/clients — linking the new account to its contact (G04)", () => {
  it("links the contacts of the person the coach just onboarded", async () => {
    const res = await POST(makeReq(), ctx)

    expect(res.status).toBe(201)
    expect(mocks.linkContactsToUser).toHaveBeenCalledWith({
      email: "dana@example.com",
      userId: "user-dana",
    })
  })

  it("links by the CREATED account's id and email, not the submitted form values", async () => {
    // The route lower-cases nothing itself, so these must come off the row
    // createUser returned. Keying on the request body instead would link the
    // wrong id the moment those two ever diverge.
    mocks.createdUser = {
      id: "user-real",
      email: "dana@example.com",
      first_name: "Dana",
      last_name: "Okafor",
      role: "client",
    }

    await POST(makeReq({ email: "dana@example.com" }), ctx)

    expect(mocks.linkContactsToUser).toHaveBeenCalledWith({
      email: "dana@example.com",
      userId: "user-real",
    })
  })

  it("still creates the account when the link throws — a link must never cost a client", async () => {
    mocks.linkContactsToUser.mockRejectedValueOnce(new Error("contacts unreachable"))

    const res = await POST(makeReq(), ctx)

    expect(res.status).toBe(201)
  })

  it("does not link when no account was created — the duplicate-email refusal", async () => {
    mocks.existingUser = { id: "someone-else", email: "dana@example.com" }

    const res = await POST(makeReq(), ctx)

    expect(res.status).toBe(409)
    expect(mocks.linkContactsToUser).not.toHaveBeenCalled()
  })

  it("does not link when the caller is not an admin", async () => {
    mocks.session = null

    const res = await POST(makeReq(), ctx)

    expect(res.status).toBe(403)
    expect(mocks.linkContactsToUser).not.toHaveBeenCalled()
  })
})
